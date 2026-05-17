import { describe, expect, it } from 'vitest';

describe('source snapshot generator', () => {
  it('excludes generated, secret, and local-only paths', async () => {
    const mod = await import('../../scripts/create-source-snapshot.mjs') as {
      shouldSkip(path: string): boolean;
      includeRoots: string[];
    };

    expect(mod.shouldSkip('.env')).toBe(true);
    expect(mod.shouldSkip('.env.firebase')).toBe(true);
    expect(mod.shouldSkip('node_modules/react/index.js')).toBe(true);
    expect(mod.shouldSkip('dist/assets/app.js')).toBe(true);
    expect(mod.shouldSkip('release/GatesAI.exe')).toBe(true);
    expect(mod.shouldSkip('src-tauri/target/release/app.exe')).toBe(true);
    expect(mod.shouldSkip('src-tauri/resources/source/current/package.json')).toBe(true);
    expect(mod.shouldSkip('src/App.tsx')).toBe(false);
    expect(mod.includeRoots).toContain('package-lock.json');
    expect(mod.includeRoots).not.toContain('node_modules');
  });
});
