# skill-check

[![ci](https://github.com/louis8408/skill-check/actions/workflows/ci.yml/badge.svg)](https://github.com/louis8408/skill-check/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=louis8408_skill-check&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=louis8408_skill-check)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=louis8408_skill-check&metric=coverage)](https://sonarcloud.io/summary/new_code?id=louis8408_skill-check)

Know when a skill you're using is out of date.

Agent skills (`SKILL.md` folders for Claude Code, Codex and other agents) change often, but once a skill is copied into your skills folder nothing tracks it. Your agent keeps running the old copy, and a stale skill doesn't fail; it just quietly does worse work.

skill-check is a plugin for **Claude Code** and **Codex** that warns, at the moment a skill is used, when a newer version exists:

```
[skill-check] The skill "speckit-plan" is out of date: installed 0.12.0, latest v0.13.1.
Run `specify self upgrade`, then `specify integration upgrade claude` in this project.
```

The agent sees the warning too, mentions it to you, and carries on. Nothing is blocked.

## How it knows

1. **`metadata.source` in SKILL.md.** The local copy is compared with the upstream one: by `metadata.version` when upstream's is higher, otherwise by content and, for GitHub sources, the file's commit history. So it notices updates even when the author never bumps the version. See [CONVENTION.md](CONVENTION.md); it works with the current Agent Skills spec, no changes needed.
2. **Spec Kit.** `speckit-*` project skills are compared with the latest [github/spec-kit](https://github.com/github/spec-kit) release, using the version Spec Kit records in `.specify/`.
3. **`npx skills`.** Personal skills installed with [`npx skills add`](https://github.com/vercel-labs/skills) are compared with the GitHub folder hash recorded in its lock file.

More ecosystems are added as adapters (one class each) without touching the rest.

## Install

Requires [Node.js](https://nodejs.org) 20 or later on your `PATH`. Nothing else: the plugin is one prebuilt file with no dependencies, so there's no `npm install` step.

### Claude Code

```
/plugin marketplace add louis8408/skill-check
/plugin install skill-check@skill-check
```

Or from a terminal:

```
claude plugin marketplace add louis8408/skill-check
claude plugin install skill-check@skill-check
```

### Codex

```
codex plugin marketplace add louis8408/skill-check
codex plugin add skill-check@skill-check
```

Codex runs plugin hooks only after you review them: start Codex, open `/hooks` and trust the three skill-check hooks. Codex asks again after each plugin update, because the hooks' files changed.

### If Node.js is missing

Without Node.js, Claude Code shows a `hook error` notice such as `node: command not found` when a skill is used (Codex shows a similar hook failure). Install Node.js 20 or later from [nodejs.org](https://nodejs.org), or with `winget install OpenJS.NodeJS.LTS` (Windows) or `brew install node` (macOS), then start a new session.

## Try it

Install an old copy (1.0.0) of the [example skill](examples/hello-skill/SKILL.md), whose current version is 1.1.0, then use it:

```bash
mkdir -p ~/.claude/skills/hello-skill
cat > ~/.claude/skills/hello-skill/SKILL.md <<'EOF'
---
name: hello-skill
description: Example skill for skill-check. Says hello. Use only when the user asks to test skill-check or says "hello skill".
metadata:
  version: 1.0.0
  source: https://github.com/louis8408/skill-check/tree/main/examples/hello-skill
---

Reply with a short, friendly greeting that mentions this is the skill-check example skill.
EOF
```

Start Claude Code and say "hello skill". You should see the out-of-date warning.

For Codex, put the copy in `~/.agents/skills/hello-skill/` instead, start Codex and type `$hello-skill`.

Check everything at once from a terminal (`npx` works once published; until then use `node plugin/dist/cli.js check` from a clone). Add `--agent codex` to see Codex's skills:

```
skill-check check --cwd path/to/project
skill-check check --agent codex --cwd path/to/project
```

```
hello-skill (personal)           outdated  1.0.0 -> 1.1.0  Update it from https://github.com/louis8408/skill-check/tree/main/examples/hello-skill.
react-best-practices (project)   outdated  1.0.0 (d65b69e, 2026-01-23) -> 1.0.0 (805687f, 2026-04-14)  Update it from https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices.
speckit-plan (project)           current   0.13.1
my-old-skill (personal)          unknown   npx-skills: no version information (add metadata.source, or install with npx skills)
```

The second line is a real result: an old copy of a Vercel skill whose version was never bumped, matched to the exact commit it came from.

## How it works

| Hook | Claude Code | Codex |
| --- | --- | --- |
| `SessionStart` (async) | Checks every visible skill in the background and caches the results. | Same. |
| `PreToolUse` | On the `Skill` tool: warns if the cached status (or a quick check, max 2 s) says the skill is out of date. | On shell commands: Codex has no Skill tool, so the model opens a skill by reading its `SKILL.md`. A command that reads `.../<skill>/SKILL.md` triggers the same check. |
| `UserPromptSubmit` | Same, for skills you type as `/skill-name`. | Same, for skills you mention as `$skill-name` (any number in one prompt). |

- Each skill is warned about once per session.
- Statuses are cached for 24 hours.
- Any failure (offline, rate-limited, odd input) means silence, never a broken session.
- Claude Code: looks at personal skills (`~/.claude/skills`) and project skills (`.claude/skills` in the working directory or any parent).
- Codex: looks at `~/.agents/skills` (where `npx skills` installs), `$CODEX_HOME/skills`, `/etc/codex/skills`, and `.agents/skills` in the working directory or any parent.
- Plugin skills and Codex's bundled skills are skipped; the agent updates those itself.

### What it reads, fetches and sends

skill-check has no server, account or telemetry. It only:

- **Reads** the skill folders listed above, `.specify/` in your project (Spec Kit), and the `npx skills` lock file.
- **Fetches** the upstream copy of a skill from the `https://` URL in its `metadata.source`, and for GitHub sources the file's recent commits from `api.github.com`. For Spec Kit skills it fetches the latest release of `github/spec-kit`, and for `npx skills` installs the folder hashes of the skill's GitHub repository.
- **Writes** its cache (`status.json`) to the plugin's data folder.

Requests carry a `skill-check/<version>` user agent and nothing about you or your project beyond the URLs above. A GitHub token is sent only if you set one (below), and only to `api.github.com` and `raw.githubusercontent.com`.

### GitHub token (optional)

Without a token, GitHub allows 60 API requests an hour, which is plenty unless you have many skills. To raise it, create a token with no scopes (skill-check only reads public files) and:

- **Claude Code:** run `/plugin configure skill-check@skill-check` and paste it into **GitHub token**. It's stored in your system's secure credential store.
- **Codex or the CLI:** set `SKILL_CHECK_GITHUB_TOKEN`.

skill-check doesn't pick up a `GITHUB_TOKEN` or `GH_TOKEN` that happens to be in your environment.

### Settings (environment variables)

| Variable | Default | |
| --- | --- | --- |
| `SKILL_CHECK_TTL_HOURS` | `24` | How long a check result is trusted. |
| `SKILL_CHECK_INLINE_TIMEOUT_MS` | `2000` | Max wait when a skill is used and nothing is cached. |
| `CODEX_HOME` | `~/.codex` | Codex's folder (Codex sets this itself). |
| `XDG_STATE_HOME` | | Where `npx skills` keeps its lock file (`$XDG_STATE_HOME/skills/.skill-lock.json`, else `~/.agents/.skill-lock.json`). |
| `SKILL_CHECK_GITHUB_TOKEN` | | GitHub token for Codex and the CLI (see above). In Claude Code, use the plugin setting instead. |
| `SKILL_CHECK_DEBUG` | | Set to `1` to log hook input to `debug.log` in the plugin data folder. |

## Development

```
npm ci
npm run verify      # typecheck, lint (zero warnings), build, tests with coverage
```

Coverage must stay at 100% (statements, branches, functions and lines); `npm run coverage` fails below that. The only file left out is `src/presentation/cli.ts`, which just wires the real process to `run()` in `main.ts` and is exercised as a child process by the end-to-end tests.

The code follows Clean Architecture: `domain` (entities and ports, no dependencies) ← `application` (use cases) ← `infrastructure` (file system, HTTP, adapters) ← `presentation` (CLI, hooks, composition root). The layer rules are enforced by tests in `tests/architecture` using dependency-cruiser.

Tests are split into `tests/unit`, `tests/integration` (real file system, a local HTTP server standing in for GitHub, and the bundled CLI run as a real process) and `tests/architecture`.

`tests/codex` runs the plugin inside the real Codex CLI, against a scripted fake model (a local stand-in for the OpenAI Responses API) and the fake GitHub, so no OpenAI account is needed. It needs `codex` on your `PATH`, so it runs separately (CI runs it in its own job):

```
npm run test:codex
```

`plugin/` holds exactly what users install: the manifests, the hooks, the bundle `plugin/dist/cli.js`, a README for the plugin directory listing, and the license. Sources, tests and `package.json` stay outside it, so installing the plugin runs no dependency install. The bundle is committed so the plugin works without an install step; CI fails if it is out of date. It's a readable (not minified) bundle of `src/`, with no third-party code: SKILL.md frontmatter is read by a small YAML subset parser (`src/infrastructure/frontmatter.ts`). Its tests check it against the `yaml` package; to compare against real skills too, point `SKILL_CHECK_CORPUS` at a folder of cloned skill repositories and run `npx vitest run tests/unit/infrastructure/frontmatter-parity.test.ts`.

`claude plugin validate --strict .` (the marketplace) and `claude plugin validate --strict plugin` should pass before a release (CI runs both).

## The bigger goal

skill-check is a reference implementation. The real aim is for skill version and source to become a normal part of the Agent Skills spec, and for agents to check them natively. If that happens, this plugin has done its job.

## License

- **Code:** [Apache-2.0](LICENSE). Use it, change it and build on it, including commercially. Redistributions must keep the `LICENSE` and [`NOTICE`](NOTICE) files and mark changed files, and the license grants no rights to the skill-check name.
- **The convention ([CONVENTION.md](CONVENTION.md)):** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Adopt it anywhere, including in specifications, with credit.

Versions up to 0.2.1 were released under MIT.
