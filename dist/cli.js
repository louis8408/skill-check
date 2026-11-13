#!/usr/bin/env node

// src/presentation/cli.ts
import { homedir } from "node:os";

// src/presentation/main.ts
import { appendFile, mkdir as mkdir2 } from "node:fs/promises";
import { dirname as dirname3 } from "node:path";

// src/domain/errors.ts
function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/presentation/config.ts
import { join } from "node:path";
function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return value !== void 0 && Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
function nonEmpty(value) {
  return value !== void 0 && value.trim() !== "" ? value.trim() : null;
}
var HOUR_MS = 36e5;
function parseAgent(args) {
  const index = args.indexOf("--agent");
  if (index === -1) return "claude";
  const value = args[index + 1];
  return value === "claude" || value === "codex" ? value : null;
}
function agentLayout(agent, env, home) {
  if (agent === "codex") {
    const codexHome = nonEmpty(env.CODEX_HOME) ?? join(home, ".codex");
    return {
      home: codexHome,
      skills: {
        personalDirs: [join(home, ".agents", "skills"), join(codexHome, "skills"), join("/", "etc", "codex", "skills")],
        projectDir: join(".agents", "skills")
      }
    };
  }
  const configDir = nonEmpty(env.CLAUDE_CONFIG_DIR) ?? join(home, ".claude");
  return { home: configDir, skills: { personalDirs: [join(configDir, "skills")], projectDir: join(".claude", "skills") } };
}
function loadConfig(env, home, agent = "claude") {
  const layout = agentLayout(agent, env, home);
  const dataDir = nonEmpty(env.CLAUDE_PLUGIN_DATA) ?? nonEmpty(env.PLUGIN_DATA) ?? join(layout.home, "skill-check");
  return {
    agent,
    skills: layout.skills,
    statusFile: nonEmpty(env.SKILL_CHECK_STATUS_FILE) ?? join(dataDir, "status.json"),
    debugLog: nonEmpty(env.SKILL_CHECK_DEBUG) ? join(dataDir, "debug.log") : null,
    ttlMs: positiveNumber(env.SKILL_CHECK_TTL_HOURS, 24) * HOUR_MS,
    inlineTimeoutMs: positiveNumber(env.SKILL_CHECK_INLINE_TIMEOUT_MS, 2e3),
    refreshTimeoutMs: positiveNumber(env.SKILL_CHECK_REFRESH_TIMEOUT_MS, 1e4),
    githubApi: nonEmpty(env.SKILL_CHECK_GITHUB_API) ?? "https://api.github.com",
    githubRaw: nonEmpty(env.SKILL_CHECK_GITHUB_RAW) ?? "https://raw.githubusercontent.com",
    // Only a token the user gave skill-check: the plugin's optional "github_token" setting
    // (Claude Code passes it as CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN) or SKILL_CHECK_GITHUB_TOKEN.
    // A GITHUB_TOKEN that happens to be in the environment is never picked up.
    githubToken: nonEmpty(env.CLAUDE_PLUGIN_OPTION_GITHUB_TOKEN) ?? nonEmpty(env.SKILL_CHECK_GITHUB_TOKEN),
    skillsLockFile: skillsLockFile(env, home)
  };
}
function skillsLockFile(env, home) {
  const state = nonEmpty(env.XDG_STATE_HOME);
  return state ? join(state, "skills", ".skill-lock.json") : join(home, ".agents", ".skill-lock.json");
}

// src/domain/version.ts
function isDigit(char) {
  return char !== void 0 && char >= "0" && char <= "9";
}
function releaseLength(text2) {
  let end = 0;
  while (end < text2.length) {
    const char = text2[end];
    const dotBeforeDigit = char === "." && end > 0 && isDigit(text2[end + 1]);
    if (!isDigit(char) && !dotBeforeDigit) break;
    end++;
  }
  return end;
}
function parseVersion(raw) {
  const trimmed = raw.trim();
  const body = trimmed.startsWith("v") || trimmed.startsWith("V") ? trimmed.slice(1) : trimmed;
  const end = releaseLength(body);
  if (end === 0) return null;
  let rest = body.slice(end);
  const build = rest.indexOf("+");
  if (build >= 0) rest = rest.slice(0, build);
  if (rest.startsWith("-") || rest.startsWith(".")) rest = rest.slice(1);
  return {
    raw: trimmed,
    release: body.slice(0, end).split(".").map(Number),
    prerelease: rest === "" ? null : rest
  };
}
function sign(n) {
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}
function compareRelease(a, b) {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return sign(diff);
  }
  return 0;
}
var NUMERIC = /^\d+$/;
function compareIdentifier(a, b) {
  const aNumeric = NUMERIC.test(a);
  const bNumeric = NUMERIC.test(b);
  if (aNumeric && bNumeric) return sign(Number(a) - Number(b));
  if (aNumeric) return -1;
  if (bNumeric) return 1;
  return sign(a.localeCompare(b, "en"));
}
function comparePrerelease(a, b) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareIdentifiers(a.split("."), b.split("."));
}
function compareIdentifiers(a, b) {
  const [headA, ...restA] = a;
  const [headB, ...restB] = b;
  if (headA === void 0 || headB === void 0) return sign(a.length - b.length);
  return compareIdentifier(headA, headB) || compareIdentifiers(restA, restB);
}
function compareVersions(a, b) {
  const release = compareRelease(a.release, b.release);
  return release === 0 ? comparePrerelease(a.prerelease, b.prerelease) : release;
}

// src/domain/status.ts
function evaluateStatus(info) {
  if (info.order === "older") {
    return { kind: "outdated", installed: info.installed, latest: info.latest, updateHint: info.updateHint };
  }
  if (info.order === "same") return { kind: "current", installed: info.installed, latest: info.latest };
  const installed = parseVersion(info.installed);
  const latest = parseVersion(info.latest);
  if (!installed || !latest) {
    return { kind: "unknown", reason: `cannot compare versions "${info.installed}" and "${info.latest}"` };
  }
  return compareVersions(installed, latest) < 0 ? { kind: "outdated", installed: info.installed, latest: info.latest, updateHint: info.updateHint } : { kind: "current", installed: info.installed, latest: info.latest };
}
function isFresh(entry, now, ttlMs) {
  return now - entry.checkedAt <= ttlMs;
}

// src/application/format-warning.ts
function formatWarning(skill, status) {
  const hint = status.updateHint ? ` ${status.updateHint}` : "";
  return `[skill-check] The skill "${skill.name}" is out of date: installed ${status.installed}, latest ${status.latest}.${hint} Briefly tell the user about this, then continue with the task.`;
}

// src/application/check-skill-on-use.ts
var MAX_REMEMBERED_SESSIONS = 20;
var CheckSkillOnUse = class {
  constructor(catalog, checker, store, clock, options) {
    this.catalog = catalog;
    this.checker = checker;
    this.store = store;
    this.clock = clock;
    this.options = options;
  }
  catalog;
  checker;
  store;
  clock;
  options;
  async execute(use) {
    const skill = await this.catalog.find(use.skillName, use.cwd);
    if (!skill) return null;
    const entry = await this.currentEntry(skill.directory, () => this.checker.check(skill, this.options.inlineTimeoutMs));
    if (entry.status.kind !== "outdated" || entry.warnedSessions.includes(use.sessionId)) return null;
    await this.store.put(skill.directory, {
      ...entry,
      warnedSessions: [...entry.warnedSessions, use.sessionId].slice(-MAX_REMEMBERED_SESSIONS)
    });
    return formatWarning(skill, entry.status);
  }
  async currentEntry(key, check2) {
    const stored = await this.store.get(key);
    const now = this.clock.now();
    if (stored && isFresh(stored, now, this.options.ttlMs)) return stored;
    const entry = { status: await check2(), checkedAt: now, warnedSessions: stored?.warnedSessions ?? [] };
    await this.store.put(key, entry);
    return entry;
  }
};

// src/application/refresh-skill-statuses.ts
var RefreshSkillStatuses = class {
  constructor(catalog, checker, store, clock, options) {
    this.catalog = catalog;
    this.checker = checker;
    this.store = store;
    this.clock = clock;
    this.options = options;
  }
  catalog;
  checker;
  store;
  clock;
  options;
  async execute(request) {
    const skills = await this.catalog.list(request.cwd);
    const reports = await Promise.all(
      skills.map(async (skill) => ({ skill, status: await this.checker.check(skill, this.options.timeoutMs) }))
    );
    const checkedAt = this.clock.now();
    const entries2 = await Promise.all(
      reports.map(async ({ skill, status }) => {
        const previous = await this.store.get(skill.directory);
        return [skill.directory, { status, checkedAt, warnedSessions: previous?.warnedSessions ?? [] }];
      })
    );
    await this.store.putAll(new Map(entries2));
    return reports;
  }
};

// src/application/skill-status-checker.ts
var SkillStatusChecker = class {
  constructor(sources) {
    this.sources = sources;
  }
  sources;
  async check(skill, timeoutMs) {
    const source = this.sources.find((s) => s.appliesTo(skill));
    if (!source) {
      return { kind: "unknown", reason: "no version information (add metadata.source)" };
    }
    try {
      return evaluateStatus(await source.resolve(skill, timeoutMs));
    } catch (error) {
      return { kind: "unknown", reason: `${source.id}: ${describeError(error)}` };
    }
  }
};

// src/infrastructure/fs-skill-catalog.ts
import { readdir, readFile } from "node:fs/promises";
import { dirname, join as join2, resolve } from "node:path";

// src/infrastructure/frontmatter.ts
var EMPTY = { name: null, metadata: {} };
var InvalidFrontmatter = class extends Error {
};
var FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
function toLines(block) {
  return block.split(/\r?\n/).map((raw) => {
    const text2 = raw.trimStart();
    return { indent: raw.length - text2.length, text: text2 };
  });
}
var isBlank = (line) => line.text === "" || line.text.startsWith("#");
function splitEntry(text2) {
  if (text2.startsWith("- ") || text2 === "-" || text2.startsWith("[") || text2.startsWith("{")) return null;
  let colon = text2.indexOf(": ");
  if (colon === -1 && text2.endsWith(":")) colon = text2.length - 1;
  if (colon === -1) return null;
  const key = unquoteKey(text2.slice(0, colon).trimEnd());
  const inline = text2.slice(colon + 1).trim();
  return [key, inline.startsWith("#") ? "" : inline];
}
function unquoteKey(key) {
  const quoted = key.length >= 2 && (key[0] === '"' || key[0] === "'") && key.endsWith(key[0]);
  return quoted ? key.slice(1, -1) : key;
}
function entries(lines) {
  const content = lines.filter((line) => !isBlank(line));
  const level = content[0]?.indent ?? 0;
  const result = [];
  for (const line of lines) {
    const current = result.at(-1);
    if (line.indent > level || isBlank(line) && current) {
      current?.children.push(line);
      continue;
    }
    if (isBlank(line)) continue;
    if (line.indent < level) throw new InvalidFrontmatter("uneven indentation");
    const split = splitEntry(line.text);
    if (split === null) return null;
    result.push({ indent: level, key: split[0], inline: split[1], children: [] });
  }
  return result;
}
function stripComment(text2) {
  if (text2.startsWith("#")) return "";
  const hash = text2.search(/\s#/);
  return (hash === -1 ? text2 : text2.slice(0, hash)).trimEnd();
}
function fold(parts) {
  let out = "";
  let pendingBreaks = 0;
  for (const part of parts) {
    if (part === "") {
      pendingBreaks++;
      continue;
    }
    if (out !== "") out += pendingBreaks > 0 ? "\n".repeat(pendingBreaks) : " ";
    out += part;
    pendingBreaks = 0;
  }
  return out;
}
function plainScalar(inline, children) {
  const first = stripComment(inline);
  if (first.startsWith("[") || first.startsWith("{") || first.startsWith("*")) return null;
  const rest = children.map((line) => stripComment(line.text));
  return fold([first, ...rest].map((part) => part.trim()));
}
var DOUBLE_QUOTE_ESCAPES = {
  "0": "\0",
  a: "\x07",
  b: "\b",
  t: "	",
  "	": "	",
  n: "\n",
  v: "\v",
  f: "\f",
  r: "\r",
  e: "\x1B",
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  N: "\x85",
  _: "\xA0",
  L: "\u2028",
  P: "\u2029"
};
function unescapeDouble(body) {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const char = body.charAt(i);
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = body.charAt(i + 1);
    const hexLength = { x: 2, u: 4, U: 8 }[next];
    if (hexLength !== void 0) {
      const hex = body.slice(i + 2, i + 2 + hexLength);
      if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length !== hexLength) throw new InvalidFrontmatter("bad hex escape");
      out += String.fromCodePoint(Number.parseInt(hex, 16));
      i += 1 + hexLength;
      continue;
    }
    const escaped = DOUBLE_QUOTE_ESCAPES[next];
    if (escaped === void 0) throw new InvalidFrontmatter(`unknown escape \${next}`);
    out += escaped;
    i++;
  }
  return out;
}
function closingQuote(text2, quote) {
  for (let i = 1; i < text2.length; i++) {
    const char = text2.charAt(i);
    if (quote === '"' && char === "\\") i++;
    else if (char === quote) {
      if (quote === "'" && text2.charAt(i + 1) === "'") i++;
      else return i;
    }
  }
  return -1;
}
function quotedScalar(inline, children) {
  const quote = inline.charAt(0);
  const whole = [inline, ...children.map((line) => line.text)].join("\n");
  const end = closingQuote(whole, quote);
  if (end === -1 || stripComment(whole.slice(end + 1)) !== "") throw new InvalidFrontmatter("bad quoted scalar");
  const folded = fold(whole.slice(1, end).split("\n").map((part, i, all) => {
    const start = i === 0 ? part : part.trimStart();
    return i === all.length - 1 ? start : start.trimEnd();
  }));
  return quote === '"' ? unescapeDouble(folded) : folded.replaceAll("''", "'");
}
function blockScalar(header, entry) {
  const children = entry.children;
  const indicator = /^([|>])([1-9]?)([+-]?)([1-9]?)$/.exec(stripComment(header));
  if (!indicator) throw new InvalidFrontmatter("bad block scalar header");
  const [, style, indentA, chomp, indentB] = indicator;
  const explicit = Number(indentA || indentB || 0);
  const content = children.filter((line) => line.text !== "");
  const base = explicit > 0 ? entry.indent + explicit : content[0]?.indent ?? 0;
  const raw = children.map((line) => line.text === "" ? "" : " ".repeat(Math.max(0, line.indent - base)) + line.text);
  let last = raw.length;
  while (last > 0 && raw[last - 1] === "") last--;
  const body = raw.slice(0, last);
  const trailing = raw.length - last;
  let text2 = style === "|" ? body.join("\n") : foldBlock(body);
  if (text2 === "") return "";
  if (chomp === "+") text2 += "\n".repeat(trailing + 1);
  else if (chomp !== "-") text2 += "\n";
  return text2;
}
function foldBlock(lines) {
  let out = "";
  let previous = null;
  for (const line of lines) {
    if (previous === null) out = line;
    else {
      const keepBreak = line === "" || previous === "" || line.startsWith(" ") || previous.startsWith(" ");
      out += (keepBreak ? "\n" : " ") + line;
    }
    previous = line;
  }
  return out.replace(/\n(\n+)/g, "$1");
}
function withoutProperties(inline) {
  let rest = inline;
  while (rest.startsWith("&") || rest.startsWith("!")) {
    const space = rest.search(/\s/);
    rest = space === -1 ? "" : rest.slice(space).trimStart();
  }
  return rest;
}
function scalar(original) {
  const entry = { ...original, inline: withoutProperties(original.inline) };
  const first = entry.inline.charAt(0);
  if (first === "|" || first === ">") return blockScalar(entry.inline, entry);
  if (first === '"' || first === "'") return quotedScalar(entry.inline, entry.children);
  if (entry.inline === "") {
    return entry.children.some((line) => !isBlank(line)) ? null : "";
  }
  return plainScalar(entry.inline, entry.children);
}
function splitFlow(body) {
  const parts = [];
  let current = "";
  let quote = "";
  let depth = 0;
  for (const char of body) {
    if (quote !== "") {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === "[" || char === "{") depth++;
    else if (char === "]" || char === "}") depth--;
    else if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter((part) => part !== "");
}
function flowMapping(entry) {
  const text2 = stripComment(entry.inline);
  if (!text2.endsWith("}")) throw new InvalidFrontmatter("unclosed flow mapping");
  const result = [];
  for (const part of splitFlow(text2.slice(1, -1))) {
    if (part.startsWith("-")) throw new InvalidFrontmatter("block list inside a flow mapping");
    const colon = part.endsWith(":") ? part.length - 1 : part.indexOf(": ");
    if (colon === -1) continue;
    const key = unquoteKey(part.slice(0, colon).trimEnd());
    result.push({ indent: entry.indent, key, inline: part.slice(colon + 1).trim(), children: [] });
  }
  return result;
}
function mapItems(entry) {
  if (entry.inline.startsWith("{")) return flowMapping(entry);
  return entry.inline === "" ? entries(entry.children) : null;
}
function stringMap(entry) {
  const items = mapItems(entry);
  if (items === null) return null;
  const map = {};
  for (const item of items) {
    const value = scalar(item);
    if (value !== null) map[item.key] = value;
  }
  return map;
}
function parseSkillFile(text2) {
  try {
    return read(text2);
  } catch {
    return EMPTY;
  }
}
function read(text2) {
  const match = FRONTMATTER.exec(text2);
  if (!match) return EMPTY;
  const top = entries(toLines(match[1]));
  if (top === null) return EMPTY;
  if (new Set(top.map((e) => e.key)).size !== top.length) return EMPTY;
  const nameEntry = top.find((e) => e.key === "name");
  const metadataEntry = top.find((e) => e.key === "metadata");
  return {
    name: nameEntry ? scalar(nameEntry) : null,
    metadata: (metadataEntry ? stringMap(metadataEntry) : null) ?? {}
  };
}

// src/infrastructure/fs-skill-catalog.ts
var SKILL_FILE = "SKILL.md";
var VALID_NAME = /^[A-Za-z0-9][\w.-]*$/;
var FileSystemSkillCatalog = class {
  constructor(locations) {
    this.locations = locations;
  }
  locations;
  async find(name, cwd) {
    if (!VALID_NAME.test(name)) return null;
    const candidates = await Promise.all(this.roots(cwd).map((root) => this.read(root, name)));
    return candidates.find((skill) => skill !== null) ?? null;
  }
  async list(cwd) {
    const perRoot = await Promise.all(
      this.roots(cwd).map(async (root) => {
        const names = await this.childFolders(root.path);
        return Promise.all(names.map((name) => this.read(root, name)));
      })
    );
    return perRoot.flat().filter((skill) => skill !== null);
  }
  roots(cwd) {
    const personal = this.locations.personalDirs.map((path) => resolve(path));
    const roots = personal.map((path) => ({ path, scope: "personal" }));
    let dir = resolve(cwd);
    for (; ; ) {
      const candidate = join2(dir, this.locations.projectDir);
      if (!personal.includes(candidate)) roots.push({ path: candidate, scope: "project" });
      const parent = dirname(dir);
      if (parent === dir) return roots;
      dir = parent;
    }
  }
  async childFolders(path) {
    try {
      const entries2 = await readdir(path, { withFileTypes: true });
      return entries2.filter((e) => e.isDirectory() && VALID_NAME.test(e.name)).map((e) => e.name);
    } catch {
      return [];
    }
  }
  async read(root, name) {
    const directory = join2(root.path, name);
    let text2;
    try {
      text2 = await readFile(join2(directory, SKILL_FILE), "utf8");
    } catch {
      return null;
    }
    return { name, directory, scope: root.scope, metadata: parseSkillFile(text2).metadata };
  }
};

// src/infrastructure/http-client.ts
var GITHUB_HOSTS = ["api.github.com", "raw.githubusercontent.com"];
var FetchHttpClient = class {
  constructor(userAgent, auth = null) {
    this.userAgent = userAgent;
    this.auth = auth;
  }
  userAgent;
  auth;
  async getText(url, timeoutMs, headers = {}) {
    const requestHeaders = { "user-agent": this.userAgent, ...headers };
    if (this.auth?.hosts.includes(new URL(url).hostname)) {
      requestHeaders.authorization = `Bearer ${this.auth.token}`;
    }
    let response;
    try {
      response = await fetch(url, { headers: requestHeaders, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") throw new Error(`timed out after ${timeoutMs} ms`, { cause: error });
      throw new Error(`request failed: ${describeError(error)}`, { cause: error });
    }
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
    return response.text();
  }
};

// src/infrastructure/json-status-store.ts
import { randomUUID } from "node:crypto";
import { mkdir, readFile as readFile2, rename, rm, writeFile } from "node:fs/promises";
import { dirname as dirname2 } from "node:path";
var SCHEMA = 1;
var RENAME_ATTEMPTS = 5;
var RENAME_RETRY_MS = 20;
var pause = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
async function replaceFile(from, to, attempt = 1) {
  try {
    await rename(from, to);
  } catch (error) {
    if (attempt >= RENAME_ATTEMPTS) throw error;
    await pause(RENAME_RETRY_MS * attempt);
    await replaceFile(from, to, attempt + 1);
  }
}
var JsonFileStatusStore = class {
  constructor(path) {
    this.path = path;
  }
  path;
  async get(key) {
    return (await this.load()).entries[key] ?? null;
  }
  put(key, value) {
    return this.putAll(/* @__PURE__ */ new Map([[key, value]]));
  }
  async putAll(values) {
    const data = await this.load();
    for (const [key, value] of values) data.entries[key] = value;
    await mkdir(dirname2(this.path), { recursive: true });
    const temp = `${this.path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, JSON.stringify(data, null, 2));
      await replaceFile(temp, this.path);
    } finally {
      await rm(temp, { force: true });
    }
  }
  async load() {
    try {
      const data = JSON.parse(await readFile2(this.path, "utf8"));
      if (typeof data === "object" && data !== null && "schema" in data && data.schema === SCHEMA && "entries" in data) {
        const entries2 = data.entries;
        if (typeof entries2 === "object" && entries2 !== null) {
          return { schema: SCHEMA, entries: entries2 };
        }
      }
    } catch {
    }
    return { schema: SCHEMA, entries: {} };
  }
};

// src/infrastructure/skills-lock-version-source.ts
import { readFile as readFile3 } from "node:fs/promises";

// src/infrastructure/text.ts
function trimTrailingSlashes(value) {
  let end = value.length;
  while (end > 0 && value[end - 1] === "/") end--;
  return value.slice(0, end);
}
function trimSlashes(value) {
  let start = 0;
  while (start < value.length && value[start] === "/") start++;
  return trimTrailingSlashes(value.slice(start));
}

// src/infrastructure/skills-lock-version-source.ts
var NOT_TRACKED = "no version information (add metadata.source, or install with npx skills)";
function isLockEntry(value) {
  const entry = value;
  return typeof entry?.source === "string" && typeof entry.sourceType === "string" && typeof entry.skillFolderHash === "string";
}
function folderOf(skillPath) {
  const path = skillPath.replaceAll("\\", "/");
  const folder = path.toLowerCase().endsWith("skill.md") ? path.slice(0, -"skill.md".length) : path;
  return folder.endsWith("/") ? folder.slice(0, -1) : folder;
}
var SkillsLockVersionSource = class {
  constructor(http, apiBase, lockPath) {
    this.http = http;
    this.apiBase = apiBase;
    this.lockPath = lockPath;
  }
  http;
  apiBase;
  lockPath;
  id = "npx-skills";
  appliesTo(skill) {
    return skill.scope === "personal";
  }
  async resolve(skill, timeoutMs) {
    const entry = await this.entry(skill.name);
    if (entry.sourceType !== "github" || !entry.skillFolderHash) {
      throw new Error(`installed by npx skills from a ${entry.sourceType} source, which it cannot check`);
    }
    const folder = folderOf(entry.skillPath ?? "");
    const latest = await this.folderHash(entry, folder, timeoutMs);
    const installedOn = entry.updatedAt ? ` (installed ${entry.updatedAt.slice(0, 10)})` : "";
    return {
      installed: `${entry.skillFolderHash.slice(0, 7)}${installedOn}`,
      latest: latest.slice(0, 7),
      updateHint: `Run \`npx skills update ${skill.name}\`.`,
      order: latest === entry.skillFolderHash ? "same" : "older"
    };
  }
  async entry(name) {
    let skills = {};
    try {
      const data = JSON.parse(await readFile3(this.lockPath, "utf8"));
      skills = data.skills ?? {};
    } catch {
    }
    const entry = skills[name];
    if (!isLockEntry(entry)) throw new Error(NOT_TRACKED);
    return entry;
  }
  async folderHash(entry, folder, timeoutMs) {
    const ref = encodeURIComponent(entry.ref ?? "HEAD");
    const url = `${trimTrailingSlashes(this.apiBase)}/repos/${entry.source}/git/trees/${ref}?recursive=1`;
    const tree = JSON.parse(await this.http.getText(url, timeoutMs, { accept: "application/vnd.github+json" }));
    const sha = folder === "" ? tree.sha : tree.tree?.find((item) => item.type === "tree" && item.path === folder)?.sha;
    if (!sha) throw new Error(`${folder} is no longer in ${entry.source}`);
    return sha;
  }
};

// src/infrastructure/source-version-source.ts
import { readFile as readFile4 } from "node:fs/promises";
import { join as join3 } from "node:path";

// src/domain/skill.ts
var METADATA_VERSION_KEY = "version";
var METADATA_SOURCE_KEY = "source";

// src/infrastructure/source-url.ts
var SKILL_FILE2 = "SKILL.md";
function parseUrl(source) {
  try {
    return new URL(source.trim());
  } catch {
    return null;
  }
}
function parseGitHubSource(source) {
  const url = parseUrl(source);
  if (url?.hostname !== "github.com") return null;
  const [owner = "", repoWithSuffix = "", kind, ref, ...rest] = trimSlashes(url.pathname).split("/");
  const repo = repoWithSuffix.endsWith(".git") ? repoWithSuffix.slice(0, -4) : repoWithSuffix;
  if (!owner || !repo) return null;
  if ((kind === "tree" || kind === "blob") && ref) {
    const inner = rest.join("/");
    const path = kind === "blob" ? inner : [inner, SKILL_FILE2].filter(Boolean).join("/");
    return { owner, repo, ref, path };
  }
  return { owner, repo, ref: null, path: SKILL_FILE2 };
}
function rawSkillUrl(source, rawBase, revision) {
  const url = parseUrl(source);
  if (!url || url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`unsupported source: ${source}`);
  const github = parseGitHubSource(source);
  if (url.hostname === "github.com") {
    if (!github) throw new Error(`unsupported source: ${source}`);
    const ref = revision ?? github.ref ?? "HEAD";
    return `${trimTrailingSlashes(rawBase)}/${github.owner}/${github.repo}/${ref}/${github.path}`;
  }
  if (url.pathname.toLowerCase().endsWith(".md")) return url.toString();
  url.pathname = `${trimTrailingSlashes(url.pathname)}/${SKILL_FILE2}`;
  return url.toString();
}

// src/infrastructure/source-version-source.ts
var MAX_REVISIONS = 30;
var PARALLEL_FETCHES = 5;
var SOURCE_LINE = /^[ \t]+source:[^\n]*\n?/gm;
function sameSkill(a, b) {
  const normalize = (text2) => text2.replaceAll("\r\n", "\n").replace(SOURCE_LINE, "").trimEnd();
  return normalize(a) === normalize(b);
}
function newerVersion(local, upstream) {
  const l = parseVersion(local);
  const u = parseVersion(upstream);
  return l !== null && u !== null && compareVersions(u, l) > 0;
}
function httpSource(skill) {
  const source = skill.metadata[METADATA_SOURCE_KEY] ?? "";
  return source.startsWith("https://") || source.startsWith("http://") ? source : null;
}
function label(version, revision) {
  const id = `${revision.sha.slice(0, 7)}, ${revision.date.slice(0, 10)}`;
  return version ? `${version} (${id})` : `${revision.sha.slice(0, 7)} (${revision.date.slice(0, 10)})`;
}
function parseRevisions(body) {
  const data = JSON.parse(body);
  if (!Array.isArray(data)) return [];
  return data.flatMap((item) => {
    const commit = item;
    const date = commit.commit?.committer?.date;
    return typeof commit.sha === "string" && typeof date === "string" ? [{ sha: commit.sha, date }] : [];
  });
}
var SourceVersionSource = class {
  constructor(http, rawBase, apiBase) {
    this.http = http;
    this.rawBase = rawBase;
    this.apiBase = apiBase;
  }
  http;
  rawBase;
  apiBase;
  id = "source";
  /** Only absolute http(s) URLs follow the convention; e.g. Spec Kit writes a relative template path. */
  /** Only absolute http(s) URLs follow the convention; e.g. Spec Kit writes a relative template path. */
  appliesTo(skill) {
    return httpSource(skill) !== null;
  }
  async resolve(skill, timeoutMs) {
    const source = httpSource(skill);
    if (source === null) throw new Error("no http(s) metadata.source");
    const deadline = Date.now() + timeoutMs;
    const localVersion = skill.metadata[METADATA_VERSION_KEY];
    const updateHint = `Update it from ${source}.`;
    const upstreamText = await this.http.getText(rawSkillUrl(source, this.rawBase), timeoutMs);
    const upstreamVersion = parseSkillFile(upstreamText).metadata[METADATA_VERSION_KEY];
    if (localVersion && upstreamVersion && newerVersion(localVersion, upstreamVersion)) {
      return { installed: localVersion, latest: upstreamVersion, updateHint };
    }
    const same = { installed: localVersion ?? "latest", latest: upstreamVersion ?? "latest", updateHint, order: "same" };
    const localText = await readFile4(join3(skill.directory, "SKILL.md"), "utf8");
    if (sameSkill(localText, upstreamText)) return same;
    const github = parseGitHubSource(source);
    if (!github) throw new Error("local copy differs from upstream and the source has no history to compare");
    const [head, ...older] = await this.revisions(github, deadline);
    const match = head && await this.findRevision(source, [head, ...older], localText, deadline);
    if (!head || !match) throw new Error("local copy matches no recent upstream revision (edited locally?)");
    if (match === head) return same;
    return { installed: label(localVersion, match), latest: label(upstreamVersion, head), updateHint, order: "older" };
  }
  async revisions(github, deadline) {
    const ref = github.ref ? `&sha=${encodeURIComponent(github.ref)}` : "";
    const url = `${trimTrailingSlashes(this.apiBase)}/repos/${github.owner}/${github.repo}/commits?path=${encodeURIComponent(github.path)}&per_page=${MAX_REVISIONS}${ref}`;
    return parseRevisions(await this.http.getText(url, remaining(deadline), { accept: "application/vnd.github+json" }));
  }
  /** Newest first, a few at a time, stopping at the first match (so it is sequential on purpose). */
  async findRevision(source, revisions, localText, deadline) {
    const batch = revisions.slice(0, PARALLEL_FETCHES);
    if (batch.length === 0) return null;
    const fetched = await Promise.all(
      batch.map(async (revision) => ({
        revision,
        text: await this.http.getText(rawSkillUrl(source, this.rawBase, revision.sha), remaining(deadline))
      }))
    );
    const found = fetched.find((f) => sameSkill(localText, f.text));
    return found ? found.revision : this.findRevision(source, revisions.slice(PARALLEL_FETCHES), localText, deadline);
  }
};
function remaining(deadline) {
  const left = deadline - Date.now();
  if (left <= 0) throw new Error("timed out");
  return left;
}

// src/infrastructure/spec-kit-version-source.ts
import { readFile as readFile5 } from "node:fs/promises";
import { join as join4, resolve as resolve2 } from "node:path";
var SPEC_KIT_SKILL = /^speckit[-.]/;
var LATEST_RELEASE_PATH = "/repos/github/spec-kit/releases/latest";
async function readJson(path) {
  try {
    const data = JSON.parse(await readFile5(path, "utf8"));
    return typeof data === "object" && data !== null ? data : null;
  } catch {
    return null;
  }
}
function text(value) {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}
var SpecKitVersionSource = class {
  constructor(http, apiBase) {
    this.http = http;
    this.apiBase = apiBase;
  }
  http;
  apiBase;
  id = "spec-kit";
  appliesTo(skill) {
    return skill.scope === "project" && SPEC_KIT_SKILL.test(skill.name);
  }
  async resolve(skill, timeoutMs) {
    const projectRoot = resolve2(skill.directory, "..", "..", "..");
    const recorded = await this.recordedVersion(join4(projectRoot, ".specify"));
    const latest = await this.latestRelease(timeoutMs);
    return {
      installed: recorded.version,
      latest,
      updateHint: `Run \`specify self upgrade\`, then \`specify integration upgrade ${recorded.integration}\` in this project.`
    };
  }
  async recordedVersion(specifyDir) {
    const integration = await readJson(join4(specifyDir, "integration.json"));
    const options = await readJson(join4(specifyDir, "init-options.json"));
    const version = text(integration?.version) ?? text(options?.speckit_version);
    if (!version) throw new Error("no Spec Kit version recorded in .specify/");
    const key = text(integration?.integration) ?? text(options?.integration) ?? text(options?.ai) ?? "claude";
    return { version, integration: key };
  }
  async latestRelease(timeoutMs) {
    const body = await this.http.getText(`${trimTrailingSlashes(this.apiBase)}${LATEST_RELEASE_PATH}`, timeoutMs, {
      accept: "application/vnd.github+json"
    });
    const tag = text(JSON.parse(body).tag_name);
    if (!tag) throw new Error("latest Spec Kit release has no tag");
    return tag;
  }
};

// src/infrastructure/system-clock.ts
var SystemClock = class {
  now() {
    return Date.now();
  }
};

// src/presentation/container.ts
function createApp(config, userAgent) {
  const http = new FetchHttpClient(userAgent, config.githubToken ? { token: config.githubToken, hosts: GITHUB_HOSTS } : null);
  const checker = new SkillStatusChecker([
    new SourceVersionSource(http, config.githubRaw, config.githubApi),
    new SpecKitVersionSource(http, config.githubApi),
    new SkillsLockVersionSource(http, config.githubApi, config.skillsLockFile)
  ]);
  const catalog = new FileSystemSkillCatalog(config.skills);
  const store = new JsonFileStatusStore(config.statusFile);
  const clock = new SystemClock();
  return {
    checkOnUse: new CheckSkillOnUse(catalog, checker, store, clock, {
      ttlMs: config.ttlMs,
      inlineTimeoutMs: config.inlineTimeoutMs
    }),
    refresh: new RefreshSkillStatuses(catalog, checker, store, clock, { timeoutMs: config.refreshTimeoutMs })
  };
}

// src/presentation/hook-input.ts
var EVENTS = /* @__PURE__ */ new Set(["PreToolUse", "UserPromptSubmit", "SessionStart"]);
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function str(value) {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}
function unique(values) {
  return [...new Set(values)];
}
var SLASH_COMMAND = /^\s*\/[\w:.-]+(?:\s|$)/;
function commandName(value) {
  const text2 = value.trim();
  const body = text2.startsWith("/") ? text2.slice(1) : text2;
  const end = body.search(/\s/);
  const name = end === -1 ? body : body.slice(0, end);
  return name === "" ? null : name;
}
function claudeSkillFromToolCall(data) {
  if (data.tool_name !== "Skill" || !isRecord(data.tool_input)) return null;
  const input = data.tool_input;
  const raw = str(input.skill) ?? str(input.name) ?? str(input.command);
  return raw === null ? null : commandName(raw);
}
function claudeSkillFromPrompt(data) {
  const prompt = str(data.prompt);
  return prompt !== null && SLASH_COMMAND.test(prompt) ? commandName(prompt) : null;
}
var readClaudeSkills = (event, data) => {
  let name = null;
  if (event === "PreToolUse") name = claudeSkillFromToolCall(data);
  else if (event === "UserPromptSubmit") name = claudeSkillFromPrompt(data);
  return name === null ? [] : [name];
};
var SKILL_NAME = /^[A-Za-z0-9][\w.-]*$/;
var SHELL_BREAK = /[\s"'`;|&()<>]+/;
var SKILL_MENTION = /(?<![\w$])\$([A-Za-z0-9][\w.-]*)/g;
function skillOfPath(token) {
  const parts = token.split(/[\\/]/);
  if (parts.length < 2 || parts.at(-1)?.toLowerCase() !== "skill.md") return null;
  const folder = String(parts.at(-2));
  return SKILL_NAME.test(folder) ? folder : null;
}
function trimTrailingPunctuation(name) {
  let end = name.length;
  while (end > 0 && (name[end - 1] === "." || name[end - 1] === "-")) end--;
  return name.slice(0, end);
}
function codexSkillsFromShell(data) {
  if (data.tool_name !== "Bash" || !isRecord(data.tool_input)) return [];
  const command = str(data.tool_input.command);
  if (command === null) return [];
  return unique(command.split(SHELL_BREAK).flatMap((token) => skillOfPath(token) ?? []));
}
function codexSkillsFromPrompt(data) {
  const prompt = str(data.prompt);
  if (prompt === null) return [];
  return unique([...prompt.matchAll(SKILL_MENTION)].map((m) => trimTrailingPunctuation(String(m[1]))));
}
var readCodexSkills = (event, data) => {
  if (event === "PreToolUse") return codexSkillsFromShell(data);
  if (event === "UserPromptSubmit") return codexSkillsFromPrompt(data);
  return [];
};
var READERS = { claude: readClaudeSkills, codex: readCodexSkills };
function readHookInput(stdin, agent) {
  let data;
  try {
    data = JSON.parse(stdin);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;
  const event = str(data.hook_event_name);
  const sessionId = str(data.session_id);
  const cwd = str(data.cwd);
  if (event === null || !EVENTS.has(event) || sessionId === null || cwd === null) return null;
  const hookEvent = event;
  return { event: hookEvent, sessionId, cwd, skillNames: READERS[agent](hookEvent, data) };
}

// src/presentation/hooks.ts
async function runHook(stdin, app, agent) {
  const input = readHookInput(stdin, agent);
  if (!input) return "";
  if (input.event === "SessionStart") {
    await app.refresh.execute({ cwd: input.cwd });
    return "";
  }
  const warnings = [];
  for (const skillName of input.skillNames) {
    const warning = await app.checkOnUse.execute({ skillName, cwd: input.cwd, sessionId: input.sessionId });
    if (warning !== null) warnings.push(warning);
  }
  if (warnings.length === 0) return "";
  const message = warnings.join("\n");
  return JSON.stringify({
    systemMessage: message,
    hookSpecificOutput: { hookEventName: input.event, additionalContext: message }
  });
}

// src/presentation/report.ts
function describe(status) {
  switch (status.kind) {
    case "outdated":
      return `outdated  ${status.installed} -> ${status.latest}  ${status.updateHint}`;
    case "current":
      return `current   ${status.installed}`;
    case "unknown":
      return `unknown   ${status.reason}`;
  }
}
function formatReport(reports) {
  if (reports.length === 0) return "No skills found.\n";
  const rows = reports.map((r) => ({ label: `${r.skill.name} (${r.skill.scope})`, status: r.status }));
  const width = Math.max(...rows.map((row) => row.label.length));
  const lines = rows.map((row) => row.label.padEnd(width) + "  " + describe(row.status));
  return `${lines.join("\n")}
`;
}

// src/presentation/main.ts
var VERSION = "0.4.0";
var USER_AGENT = `skill-check/${VERSION} (+https://github.com/louis8408/skill-check)`;
var HELP = `skill-check ${VERSION}: warns when an agent skill is used while out of date.

Usage:
  skill-check hook [--agent claude|codex]               Run as a hook (reads hook JSON on stdin).
  skill-check check [--agent claude|codex] [--cwd DIR]  Check every skill visible from DIR and print the results.
  skill-check --version

--agent picks where skills live and how hook input looks: claude (Claude Code, the default) or codex (Codex CLI).
`;
async function debugLog(config, line) {
  if (!config.debugLog) return;
  await mkdir2(dirname3(config.debugLog), { recursive: true });
  await appendFile(config.debugLog, `${(/* @__PURE__ */ new Date()).toISOString()} ${line}
`);
}
async function hook(config, io) {
  try {
    const stdin = await io.readStdin();
    await debugLog(config, stdin.trim());
    const output = await runHook(stdin, createApp(config, USER_AGENT), config.agent);
    if (output) io.write(output);
  } catch (error) {
    await debugLog(config, `error: ${describeError(error)}`).catch(() => void 0);
  }
}
async function check(config, args, io) {
  const cwdIndex = args.indexOf("--cwd");
  const cwd = (cwdIndex >= 0 ? args[cwdIndex + 1] : void 0) ?? io.cwd;
  const reports = await createApp(config, USER_AGENT).refresh.execute({ cwd });
  io.write(formatReport(reports));
}
async function run(args, io) {
  const [command, ...rest] = args;
  const agent = parseAgent(rest);
  if (agent === null) {
    io.write(HELP);
    return;
  }
  const config = loadConfig(io.env, io.home, agent);
  switch (command) {
    case "hook":
      return hook(config, io);
    case "check":
      return check(config, rest, io);
    case "--version":
    case "-v":
      io.write(`${VERSION}
`);
      return;
    default:
      io.write(HELP);
  }
}

// src/presentation/cli.ts
async function readStdin() {
  if (process.stdin.isTTY) return "";
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}
await run(process.argv.slice(2), {
  env: process.env,
  home: homedir(),
  cwd: process.cwd(),
  readStdin,
  write: (text2) => process.stdout.write(text2)
});
