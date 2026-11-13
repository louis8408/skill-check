# skill-check

Know when a skill you're using is out of date.

Agent skills (`SKILL.md` folders) change often, but once a skill is copied into your skills folder nothing tracks it. Claude keeps running the old copy, and a stale skill doesn't fail; it just quietly does worse work.

skill-check warns at the moment a skill is used, when a newer version exists:

```
[skill-check] The skill "speckit-plan" is out of date: installed 0.12.0, latest v0.13.1.
Run `specify self upgrade`, then `specify integration upgrade claude` in this project.
```

Claude sees the warning too, mentions it to you, and carries on. Nothing is blocked, and no tool call is approved, changed or denied.

## Install

Add it from the plugin directory, or in Claude Code:

```
/plugin install skill-check --marketplace louis8408/skill-check
```

## Requirements

[Node.js](https://nodejs.org) 20 or later on your `PATH`. The plugin is one readable JavaScript file with no dependencies, so nothing is installed. Without Node.js, Claude Code shows a `hook error` notice when a skill is used.

## How it knows a skill is out of date

1. **`metadata.source` in SKILL.md.** The local copy is compared with the upstream copy at that URL: by `metadata.version` when upstream's is higher, otherwise by content and, for GitHub sources, the file's commit history.
2. **Spec Kit.** `speckit-*` project skills are compared with the latest [github/spec-kit](https://github.com/github/spec-kit) release.
3. **`npx skills`.** Skills installed with `npx skills add` are compared with the folder hash recorded in its lock file.

## What it runs, reads, fetches and sends

skill-check has no server, account or telemetry. Its hooks run `node dist/cli.js hook` at session start (in the background), when the Skill tool is used, and when you type a `/skill`. Each hook prints at most one warning. It only:

- **Reads** your personal skills (`~/.claude/skills`), the project's `.claude/skills`, `.specify/` in your project (Spec Kit), and the `npx skills` lock file.
- **Fetches** the upstream copy of a skill from the `https://` URL in its `metadata.source`, and for GitHub sources the file's recent commits from `api.github.com`. For Spec Kit skills it fetches the latest release of `github/spec-kit`, and for `npx skills` installs the folder hashes of the skill's GitHub repository.
- **Writes** its cache (`status.json`) to the plugin's data folder.

Requests carry a `skill-check/<version>` user agent and nothing about you or your project beyond the URLs above.

## GitHub token (optional)

Without a token, GitHub allows 60 API requests an hour, which is plenty unless you have many skills. To raise the limit, create a GitHub token with no scopes, run `/plugin configure skill-check@skill-check` (or `skill-check@synced` if you added it from the directory), and paste it into **GitHub token**. Claude Code keeps it in your system's secure credential store, and skill-check sends it only to `api.github.com` and `raw.githubusercontent.com`.

## More

Source, settings, Codex support and the `metadata.version` / `metadata.source` convention: [github.com/louis8408/skill-check](https://github.com/louis8408/skill-check). Licensed under [Apache-2.0](LICENSE).
