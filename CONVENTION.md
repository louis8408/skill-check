# SKILL.md source and version convention

**Status:** proposal, v0.2. Works today with the current [Agent Skills specification](https://agentskills.io/specification); no spec change is needed to adopt it.

## The problem

Once a skill is copied into `~/.claude/skills`, `.claude/skills` or any other agent's skill folder, nothing records where it came from. Agents load and run it without knowing whether a newer version exists. A stale skill doesn't fail; it quietly produces worse results.

npm, pip and every other package manager solved this by recording where each package came from. Skills dropped that information.

## The convention

Add `source` to the spec's existing optional `metadata` map, next to the `version` many skills already have:

```yaml
---
name: deploy
description: Deploys the service to staging or production.
metadata:
  version: "1.4.0"
  source: https://github.com/acme/skills/tree/main/skills/deploy
---
```

| Key | | Meaning |
| --- | --- | --- |
| `metadata.source` | **required** | Where the canonical copy of the skill lives. It travels with every copy, so any tool can find the upstream skill. |
| `metadata.version` | recommended | The version of this skill. The spec's own example already uses it (`version: "1.0"`), and repos such as [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills) do too. Quote it so YAML doesn't read `1.10` as a number. |

### Why `source` matters more than `version`

In practice authors rarely bump `version`. For example, `react-best-practices` in vercel-labs/agent-skills changed about ten times between January and April 2026 and stayed at `1.0.0` throughout. A check based only on version numbers would say "up to date" forever.

With `source`, a tool doesn't need the author to bump anything. It compares the local copy with the upstream file and, for GitHub sources, with that file's commit history:

- matches upstream: **current**
- matches an older upstream revision: **outdated** (and the tool can say which commit it came from)
- matches nothing: **edited locally**

When `version` *is* bumped, tools use it as the faster, clearer signal.

### `version` is the skill's version

`metadata.version` is the version of the skill itself. If a skill covers a library and you want to record which library version it targets, use another key (for example `library-version: "4.x"`) so tools don't mistake it for the skill's version.

### `source` forms

- A GitHub folder: `https://github.com/<owner>/<repo>/tree/<ref>/<path-to-skill-folder>`
- A GitHub file: `https://github.com/<owner>/<repo>/blob/<ref>/<path>/SKILL.md`
- A GitHub repository whose root is the skill: `https://github.com/<owner>/<repo>`
- Any other `https://` URL to the skill folder or to the `SKILL.md` file itself (content comparison only, no history).

`ref` should normally be the branch you publish from (e.g. `main`), not a tag.

`source` must be an absolute `https://` URL. Tools ignore any other value. For example, Spec Kit currently writes the template it generated the skill from (`source: "templates/commands/plan.md"`), which isn't resolvable outside Spec Kit.

## Rules for skill authors

1. Add `metadata.source` pointing at the canonical copy of the skill.
2. Bump `metadata.version` when you change the skill's behaviour, if you can. If you forget, `source` still lets tools notice.
3. That's all. No registry, no lockfile, no build step.

## Rules for installers

- If you copy a skill that has no `metadata.source`, you may add it. Tools ignore the `source` line when comparing content, so adding it doesn't make the copy look "edited".
- Recording the source in your own lock file works too. skill-check reads the `npx skills` lock file (`~/.agents/.skill-lock.json`) for exactly this reason.

## Rules for tools and agents

1. When a skill is about to run, compare it with its `metadata.source` (by version if both sides have one and upstream's is higher, else by content and history).
2. If upstream is newer, tell the user, and don't block the skill.
3. Cache the result; never make skill invocation wait on the network for long.
4. Treat a missing or unreachable source as "unknown", not as an error.

## Why `metadata` and not top-level fields?

The Agent Skills spec defines `metadata` as a free-form string map for exactly this kind of extension, and agents that are strict about frontmatter keys accept it. If the convention proves useful, the natural next step is for the spec to make `source` (and `version`) recommended fields.

## Reference implementation

[skill-check](https://github.com/louis8408/skill-check) implements the tool rules above as a Claude Code plugin.
