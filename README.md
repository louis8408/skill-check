# skill-check

[![ci](https://github.com/louis8408/skill-check/actions/workflows/ci.yml/badge.svg)](https://github.com/louis8408/skill-check/actions/workflows/ci.yml)
[![Quality Gate Status](https://sonarcloud.io/api/project_badges/measure?project=louis8408_skill-check&metric=alert_status)](https://sonarcloud.io/summary/new_code?id=louis8408_skill-check)
[![Coverage](https://sonarcloud.io/api/project_badges/measure?project=louis8408_skill-check&metric=coverage)](https://sonarcloud.io/summary/new_code?id=louis8408_skill-check)

Know when a skill you're using is out of date.

Agent skills (`SKILL.md` folders for Claude Code and other agents) change often, but once a skill is copied into your skills folder nothing tracks it. Your agent keeps running the old copy, and a stale skill doesn't fail; it just quietly does worse work.

skill-check is a Claude Code plugin that warns, at the moment a skill is used, when a newer version exists:

```
[skill-check] The skill "speckit-plan" is out of date: installed 0.12.0, latest v0.13.1.
Run `specify self upgrade`, then `specify integration upgrade claude` in this project.
```

Claude sees the warning too, mentions it to you, and carries on. Nothing is blocked.

## How it knows

1. **`metadata.source` in SKILL.md.** The local copy is compared with the upstream one: by `metadata.version` when upstream's is higher, otherwise by content and, for GitHub sources, the file's commit history. So it notices updates even when the author never bumps the version. See [CONVENTION.md](CONVENTION.md); it works with the current Agent Skills spec, no changes needed.
2. **Spec Kit.** `speckit-*` project skills are compared with the latest [github/spec-kit](https://github.com/github/spec-kit) release, using the version Spec Kit records in `.specify/`.
3. **`npx skills`.** Personal skills installed with [`npx skills add`](https://github.com/vercel-labs/skills) are compared with the GitHub folder hash recorded in its lock file.

More ecosystems are added as adapters (one class each) without touching the rest.

## Install

Requires Node.js 20 or later on your `PATH`.

```
/plugin marketplace add louis8408/skill-check
/plugin install skill-check@skill-check
```

Or from a terminal:

```
claude plugin marketplace add louis8408/skill-check
claude plugin install skill-check@skill-check
```

## Try it

Install an old copy of the example skill, then use it:

```bash
mkdir -p ~/.claude/skills/hello-skill
curl -sL https://raw.githubusercontent.com/louis8408/skill-check/main/examples/hello-skill/SKILL.md \
  | sed 's/version: 1.1.0/version: 1.0.0/' > ~/.claude/skills/hello-skill/SKILL.md
```

Start Claude Code and say "hello skill". You should see the out-of-date warning.

Check everything at once from a terminal (`npx` works once published; until then use `node dist/cli.js check` from a clone):

```
skill-check check --cwd path/to/project
```

```
hello-skill (personal)           outdated  1.0.0 -> 1.1.0  Update it from https://github.com/louis8408/skill-check/tree/main/examples/hello-skill.
react-best-practices (project)   outdated  1.0.0 (d65b69e, 2026-01-23) -> 1.0.0 (805687f, 2026-04-14)  Update it from https://github.com/vercel-labs/agent-skills/tree/main/skills/react-best-practices.
speckit-plan (project)           current   0.13.1
my-old-skill (personal)          unknown   npx-skills: no version information (add metadata.source, or install with npx skills)
```

The second line is a real result: an old copy of a Vercel skill whose version was never bumped, matched to the exact commit it came from.

## How it works

| Hook | What it does |
| --- | --- |
| `SessionStart` (async) | Checks every visible skill in the background and caches the results. |
| `PreToolUse` on `Skill` | When Claude invokes a skill, warns if the cached status (or a quick check, max 2 s) says it's out of date. |
| `UserPromptSubmit` | Same, for skills you type as `/skill-name`. |

- Each skill is warned about once per session.
- Statuses are cached for 24 hours.
- Any failure (offline, rate-limited, odd input) means silence, never a broken session.
- Looks at personal skills (`~/.claude/skills`) and project skills (`.claude/skills` in the working directory or any parent). Plugin skills are skipped; Claude Code updates plugins itself.

### Settings (environment variables)

| Variable | Default | |
| --- | --- | --- |
| `SKILL_CHECK_TTL_HOURS` | `24` | How long a check result is trusted. |
| `SKILL_CHECK_INLINE_TIMEOUT_MS` | `2000` | Max wait when a skill is used and nothing is cached. |
| `XDG_STATE_HOME` | | Where `npx skills` keeps its lock file (`$XDG_STATE_HOME/skills/.skill-lock.json`, else `~/.agents/.skill-lock.json`). |
| `GITHUB_TOKEN` / `GH_TOKEN` | | Raises GitHub's rate limit (60 API requests an hour without a token). Only sent to `api.github.com` and `raw.githubusercontent.com`. |
| `SKILL_CHECK_DEBUG` | | Set to `1` to log hook input to `debug.log` in the plugin data folder. |

## Development

```
npm ci
npm run verify      # typecheck, lint (zero warnings), build, tests with coverage
```

Coverage must stay at 100% (statements, branches, functions and lines); `npm run coverage` fails below that. The only file left out is `src/presentation/cli.ts`, which just wires the real process to `run()` in `main.ts` and is exercised as a child process by the end-to-end tests.

The code follows Clean Architecture: `domain` (entities and ports, no dependencies) ← `application` (use cases) ← `infrastructure` (file system, HTTP, adapters) ← `presentation` (CLI, hooks, composition root). The layer rules are enforced by tests in `tests/architecture` using dependency-cruiser.

Tests are split into `tests/unit`, `tests/integration` (real file system, a local HTTP server standing in for GitHub, and the bundled CLI run as a real process) and `tests/architecture`.

`dist/cli.js` is committed so the plugin works without an install step; CI fails if it is out of date.

## The bigger goal

skill-check is a reference implementation. The real aim is for skill version and source to become a normal part of the Agent Skills spec, and for agents to check them natively. If that happens, this plugin has done its job.

## License

- **Code:** [Apache-2.0](LICENSE). Use it, change it and build on it, including commercially. Redistributions must keep the `LICENSE` and [`NOTICE`](NOTICE) files and mark changed files, and the license grants no rights to the skill-check name.
- **The convention ([CONVENTION.md](CONVENTION.md)):** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Adopt it anywhere, including in specifications, with credit.

Versions up to 0.2.1 were released under MIT.
