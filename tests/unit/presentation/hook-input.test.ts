import { describe, expect, it } from 'vitest';
import { readHookInput } from '../../../src/presentation/hook-input.js';

const base = { session_id: 's1', cwd: '/work', transcript_path: '/t.jsonl' };

describe('readHookInput', () => {
  it('reads the skill name from a PreToolUse call of the Skill tool', () => {
    const input = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: 'deploy' } };
    expect(readHookInput(JSON.stringify(input))).toEqual({ event: 'PreToolUse', sessionId: 's1', cwd: '/work', skillName: 'deploy' });
  });

  it('accepts other plausible field names and strips a leading slash and arguments', () => {
    const named = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { name: '/deploy prod' } };
    expect(readHookInput(JSON.stringify(named))?.skillName).toBe('deploy');
    const command = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { command: 'deploy' } };
    expect(readHookInput(JSON.stringify(command))?.skillName).toBe('deploy');
  });

  it('finds no skill when the Skill call names none', () => {
    const empty = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { other: 'x' } };
    expect(readHookInput(JSON.stringify(empty))?.skillName).toBeNull();
    const slashOnly = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: { skill: '/' } };
    expect(readHookInput(JSON.stringify(slashOnly))?.skillName).toBeNull();
    const notAnObject = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Skill', tool_input: 'deploy' };
    expect(readHookInput(JSON.stringify(notAnObject))?.skillName).toBeNull();
  });

  it('ignores PreToolUse calls of other tools', () => {
    const input = { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } };
    expect(readHookInput(JSON.stringify(input))?.skillName).toBeNull();
  });

  it('reads a slash command typed by the user', () => {
    const input = { ...base, hook_event_name: 'UserPromptSubmit', prompt: '  /speckit-plan add login' };
    expect(readHookInput(JSON.stringify(input))?.skillName).toBe('speckit-plan');
  });

  it('ignores ordinary prompts, a lone slash, and a missing prompt', () => {
    for (const prompt of ['please use a/b testing', '/', '/not,a-command']) {
      expect(readHookInput(JSON.stringify({ ...base, hook_event_name: 'UserPromptSubmit', prompt }))?.skillName).toBeNull();
    }
    expect(readHookInput(JSON.stringify({ ...base, hook_event_name: 'UserPromptSubmit' }))?.skillName).toBeNull();
  });

  it('reads a bare slash command with no arguments', () => {
    expect(readHookInput(JSON.stringify({ ...base, hook_event_name: 'UserPromptSubmit', prompt: '/deploy' }))?.skillName).toBe('deploy');
  });

  it('passes SessionStart through with no skill', () => {
    const input = { ...base, hook_event_name: 'SessionStart', source: 'startup' };
    expect(readHookInput(JSON.stringify(input))).toEqual({ event: 'SessionStart', sessionId: 's1', cwd: '/work', skillName: null });
  });

  it('returns null for invalid or unexpected input', () => {
    expect(readHookInput('not json')).toBeNull();
    expect(readHookInput('[]')).toBeNull();
    expect(readHookInput(JSON.stringify({ hook_event_name: 'PreToolUse' }))).toBeNull();
    expect(readHookInput(JSON.stringify({ ...base, hook_event_name: 'Stop' }))).toBeNull();
  });
});
