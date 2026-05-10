import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('tauri security config', () => {
  it('allows sandboxed HTML artifact previews to run common dashboard CDNs', () => {
    const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')) as {
      app?: { security?: { csp?: string } };
    };
    const csp = config.app?.security?.csp ?? '';

    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(csp).toContain('https://cdn.tailwindcss.com');
    expect(csp).toContain('https://cdn.jsdelivr.net');
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https:");
    expect(csp).toContain("object-src 'none'");
  });
});
