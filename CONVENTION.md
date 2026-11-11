# SKILL.md version and source convention

**Status:** proposal, v0.1. Works today with the current [Agent Skills specification](https://agentskills.io/specification); no spec change is needed to adopt it.

## The problem

Once a skill is copied into `~/.claude/skills`, `.claude/skills` or any other agent's skill folder, nothing records what it is or where it came from. Agents load and run it without knowing whether a newer version exists. A stale skill doesn't fail; it quietly produces worse results.

npm, pip and every other package manager solved this by recording a name, a version and a registry with each package. Skills dropped that information.

## The convention

Put two keys in the spec's existing optional `metadata` map:

```yaml
---
name: deploy
description: Deploys the service to staging or production.
metadata:
  version: 1.4.0
  source: https://github.com/acme/skills/tree/main/skills/deploy
---
```

| Key | Required | Meaning |
| --- | --- | --- |
| `metadata.version` | yes | The version of this copy of the skill. Use [semver](https://semver.org) (`1.4.0`, `2.0.0-rc.1`). Quote it if YAML could read it as a number (`"1.10"`). |
| `metadata.source` | yes | Where the canonical copy of the skill lives, so a tool can fetch its current `metadata.version`. |

### `source` forms

- A GitHub folder: `https://github.com/<owner>/<repo>/tree/<ref>/<path-to-skill-folder>`
- A GitHub file: `https://github.com/<owner>/<repo>/blob/<ref>/<path>/SKILL.md`
- A GitHub repository whose root is the skill: `https://github.com/<owner>/<repo>`
- Any other `https://` URL to the skill folder or to the `SKILL.md` file itself.

`ref` should normally be the branch you publish from (e.g. `main`), not a tag. The checker reads the upstream `SKILL.md` at that location and compares its `metadata.version` with the local one.

## Rules for skill authors

1. Bump `metadata.version` in the canonical `SKILL.md` whenever you change the skill's behaviour.
2. Keep `metadata.source` pointing at the canonical copy. It travels with every copy of the skill.
3. That's all. No registry, no lockfile, no build step.

## Rules for tools and agents

1. When a skill is about to run, compare its `metadata.version` with the version at `metadata.source`.
2. If the upstream version is newer, tell the user, and don't block the skill.
3. Cache the result; never make skill invocation wait on the network for long.
4. Treat a missing or unreachable source as "unknown", not as an error.

## Why `metadata` and not top-level fields?

The Agent Skills spec defines `metadata` as a free-form string map for exactly this kind of extension, and agents that are strict about frontmatter keys (some reject unknown top-level keys) already accept it. If the convention proves useful, the natural next step is for the spec to promote `version` and `source` to recommended fields.

## Reference implementation

[skill-check](https://github.com/louis8408/skill-check) implements the tool rules above as a Claude Code plugin.
