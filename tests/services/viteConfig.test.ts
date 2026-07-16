import { describe, expect, it } from 'vitest';
import { viteHmrOptions, viteWatchOptions } from '../../vite.config';

describe('viteWatchOptions', () => {
  it('ignores every file for disposable e2e servers', () => {
    expect(viteWatchOptions({ GATESAI_VITE_NO_WATCH: '1' })).toEqual({
      ignored: ['**/*'],
    });
    expect(viteHmrOptions({ GATESAI_VITE_NO_WATCH: '1' })).toBe(false);
  });

  it('keeps the cargo target exclusion for ordinary development servers', () => {
    expect(viteWatchOptions({})).toEqual({
      ignored: ['**/src-tauri/target/**'],
    });
    expect(viteHmrOptions({})).toBeUndefined();
  });
});
