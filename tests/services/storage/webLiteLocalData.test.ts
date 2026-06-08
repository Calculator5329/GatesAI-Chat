import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearLocalDataExceptCredentials } from '../../../src/services/storage/webLiteLocalData';
import { clearAppStorage } from '../../helpers/storage';

describe('webLiteLocalData (Batch E)', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => clearAppStorage());

  it('clearLocalDataExceptCredentials removes app data but keeps provider keys', () => {
    localStorage.setItem('gatesai.state.v1', JSON.stringify({ threads: [], activeThreadId: null }));
    localStorage.setItem('gatesai.notes.v1', JSON.stringify({ notes: [] }));
    localStorage.setItem('gatesai.providers.v1', JSON.stringify({ openrouter: { apiKey: 'keep-me' } }));

    clearLocalDataExceptCredentials();

    expect(localStorage.getItem('gatesai.state.v1')).toBeNull();
    expect(localStorage.getItem('gatesai.notes.v1')).toBeNull();
    expect(localStorage.getItem('gatesai.providers.v1')).toContain('keep-me');
  });
});
