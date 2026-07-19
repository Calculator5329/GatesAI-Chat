import { beforeEach, describe, expect, it } from 'vitest';
import {
  CURRENT_USER_SYSTEM_PROMPT_SCHEMA_VERSION,
  USER_SYSTEM_PROMPT_STORAGE_KEY,
  appendUserSystemPrompt,
  loadUserSystemPromptSettings,
  migrateUserSystemPromptSettings,
  saveUserSystemPromptSettings,
} from '../../../src/services/chat/userSystemPrompt';
import { clearAppStorage } from '../../helpers/storage';

describe('user system prompt settings', () => {
  beforeEach(() => clearAppStorage());

  it('migrates the existing profile default when the versioned slot is absent', () => {
    const loaded = loadUserSystemPromptSettings('Existing global prompt.');

    expect(loaded).toEqual({
      schemaVersion: CURRENT_USER_SYSTEM_PROMPT_SCHEMA_VERSION,
      globalDefault: 'Existing global prompt.',
      threadOverrides: {},
    });
    expect(JSON.parse(localStorage.getItem(USER_SYSTEM_PROMPT_STORAGE_KEY) ?? '{}')).toEqual(loaded);
  });

  it('migrates early global and per-thread field aliases and drops blank overrides', () => {
    expect(migrateUserSystemPromptSettings({
      defaultSystemPrompt: 'Legacy global.',
      perThreadOverrides: {
        alpha: 'Alpha override.',
        blank: '   ',
        invalid: 42,
      },
    })).toEqual({
      schemaVersion: CURRENT_USER_SYSTEM_PROMPT_SCHEMA_VERSION,
      globalDefault: 'Legacy global.',
      threadOverrides: { alpha: 'Alpha override.' },
    });
  });

  it('round-trips the canonical global and per-thread fields', () => {
    saveUserSystemPromptSettings({
      schemaVersion: CURRENT_USER_SYSTEM_PROMPT_SCHEMA_VERSION,
      globalDefault: 'Global.',
      threadOverrides: { alpha: 'Alpha.', beta: 'Beta.' },
    });

    expect(loadUserSystemPromptSettings('Ignored legacy fallback.')).toEqual({
      schemaVersion: CURRENT_USER_SYSTEM_PROMPT_SCHEMA_VERSION,
      globalDefault: 'Global.',
      threadOverrides: { alpha: 'Alpha.', beta: 'Beta.' },
    });
  });

  it('appends user text after the derived scaffold and keeps the contract boundary', () => {
    const composed = appendUserSystemPrompt('Safety/tool scaffold.', 'Prefer terse answers.') ?? '';

    expect(composed).toContain('Safety/tool scaffold.');
    expect(composed).toContain('Prefer terse answers.');
    expect(composed).toContain('cannot grant tools, remove safety limits');
    expect(composed.indexOf('Safety/tool scaffold.')).toBeLessThan(composed.indexOf('Prefer terse answers.'));
  });
});
