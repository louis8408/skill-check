import { describe, expect, it } from 'vitest';
import { readHookInput } from '../../../src/presentation/hook-input.js';

const base = { session_id: 's1', cwd: '/work', transcript_path: '/t.jsonl' };
const claude = (input: object) => readHookInput(JSON.stringify(input), 'claude');
const codex = (input: object) => readHookInput(JSON.stringify(input), 'codex');

describe('readHookInput for Claude Code', () => {
  it('reads the skill name from a PreToolUse call of the Skill tool', () => {
    const input = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'deploy' } };
    expect(claude(input)).toEqual({ event: 'PreToolUse', sessionId: 's1', cwd: '/work', skillNames: ['deploy'] });
  });

  it('accepts other plausible field names and strips a leading slash and arguments', () => {
    const named = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { name: '/deploy prod' } };
    expect(claude(named)?.skillNames).toEqual(['deploy']);
    const command = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { command: 'deploy' } };
    expect(claude(command)?.skillNames).toEqual(['deploy']);
  });

  it('finds no skill when the Skill call names none', () => {
    const empty = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { other: 'x' } };
    expect(claude(empty)?.skillNames).toEqual([]);
    const slashOnly = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: '/' } };
    expect(claude(slashOnly)?.skillNames).toEqual([]);
    const notAnObject = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: 'deploy' };
    expect(claude(notAnObject)?.skillNames).toEqual([]);
  });

  it('ignores PreToolUse calls of other tools, including shell reads of SKILL.md', () => {
    const input = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'cat a/deploy/SKILL.md' } };
    expect(claude(input)?.skillNames).toEqual([]);
  });

  it('reads a slash command typed by the user', () => {
    expect(claude({ ...base, hook_event_name: 'UserPromptSubmit', prompt: '  /speckit-plan add login' })?.skillNames).toEqual(['speckit-plan']);
  });

  it('ignores ordinary prompts, $mentions, a lone slash, and a missing prompt', () => {
    for (const prompt of ['please use a/b testing', '/', '/not,a-command', 'use $deploy']) {
      expect(claude({ ...base, hook_event_name: 'UserPromptSubmit', prompt })?.skillNames).toEqual([]);
    }
    expect(claude({ ...base, hook_event_name: 'UserPromptSubmit' })?.skillNames).toEqual([]);
  });

  it('reads a bare slash command with no arguments', () => {
    expect(claude({ ...base, hook_event_name: 'UserPromptSubmit', prompt: '/deploy' })?.skillNames).toEqual(['deploy']);
  });

  it('passes SessionStart through with no skill', () => {
    const input = { ...base, hook_event_name: 'SessionStart', source: 'startup' };
    expect(claude(input)).toEqual({ event: 'SessionStart', sessionId: 's1', cwd: '/work', skillNames: [] });
  });

  it('returns null for invalid or unexpected input', () => {
    expect(readHookInput('not json', 'claude')).toBeNull();
    expect(readHookInput('[]', 'claude')).toBeNull();
    expect(claude({ hook_event_name: 'PreToolUse' })).toBeNull();
    expect(claude({ ...base, hook_event_name: 'Stop' })).toBeNull();
  });
});

// Shapes below were captured from Codex CLI 0.169.0 (see tests/integration/codex/).
describe('readHookInput for Codex', () => {
  const shell = (command: unknown) => codex({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command } });

  it('reads the skill from a shell command that opens its SKILL.md', () => {
    expect(shell('Get-Content -Raw .agents/skills/hello-skill/SKILL.md')?.skillNames).toEqual(['hello-skill']);
    expect(shell("sed -n '1,200p' /home/me/.agents/skills/deploy/SKILL.md")?.skillNames).toEqual(['deploy']);
    expect(shell('type "C:\\Users\\me\\.agents\\skills\\deploy\\SKILL.md"')?.skillNames).toEqual(['deploy']);
  });

  it('reads every skill a command opens, once each', () => {
    expect(shell('cat a/x/SKILL.md b/y/skill.md a/x/SKILL.md')?.skillNames).toEqual(['x', 'y']);
  });

  it('ignores shell commands that open no SKILL.md, and other tools', () => {
    expect(shell('ls .agents/skills')?.skillNames).toEqual([]);
    expect(shell('cat SKILL.md')?.skillNames).toEqual([]);
    expect(shell(['cat', 'a/x/SKILL.md'])?.skillNames).toEqual([]);
    const edit = { ...base, hook_event_name: 'PreToolUse', tool_name: 'apply_patch', tool_input: { command: 'a/x/SKILL.md' } };
    expect(codex(edit)?.skillNames).toEqual([]);
  });

  it('reads $skill mentions anywhere in the prompt', () => {
    const prompt = 'please use $hello-skill, then ($deploy). Cost: $5 and $HOME.';
    expect(codex({ ...base, hook_event_name: 'UserPromptSubmit', prompt })?.skillNames).toEqual(['hello-skill', 'deploy', '5', 'HOME']);
  });

  it('ignores slash commands, which are Codex built-ins rather than skills', () => {
    expect(codex({ ...base, hook_event_name: 'UserPromptSubmit', prompt: '/review' })?.skillNames).toEqual([]);
  });

  it('finds nothing in a missing prompt or shell input, or at session start', () => {
    expect(codex({ ...base, hook_event_name: 'UserPromptSubmit' })?.skillNames).toEqual([]);
    expect(codex({ ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: 'cat a/x/SKILL.md' })?.skillNames).toEqual([]);
    expect(codex({ ...base, hook_event_name: 'SessionStart', source: 'startup' })).toEqual({ event: 'SessionStart', sessionId: 's1', cwd: '/work', skillNames: [] });
  });

  it('skips SKILL.md paths whose folder is not a valid skill name', () => {
    expect(shell('cat ../SKILL.md ./.hidden/SKILL.md')?.skillNames).toEqual([]);
  });
});
