import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE, formatHash, parseHash } from '../../src/services/router';

describe('router', () => {
  it('parses an empty hash to the default route', () => {
    expect(parseHash('')).toEqual(DEFAULT_ROUTE);
    expect(parseHash('#')).toEqual(DEFAULT_ROUTE);
    expect(parseHash('#/')).toEqual(DEFAULT_ROUTE);
  });

  it('parses thread routes', () => {
    expect(parseHash('#/thread/abc')).toEqual({ kind: 'thread', threadId: 'abc' });
    expect(parseHash('#/thread/'))   .toEqual({ kind: 'thread', threadId: null });
  });

  it('parses menu routes and rejects unknown sections', () => {
    expect(parseHash('#/menu/models')).toEqual({ kind: 'menu', section: 'models' });
    expect(parseHash('#/menu/agent')).toEqual({ kind: 'menu', section: 'agent' });
    expect(parseHash('#/menu'))      .toEqual({ kind: 'menu', section: 'settings' });
    expect(parseHash('#/menu/wat'))  .toEqual({ kind: 'menu', section: 'settings' });
    expect(parseHash('#/menu/appearance')).toEqual({ kind: 'menu', section: 'settings' });
  });

  it('redirects legacy menu hashes to their new homes', () => {
    expect(parseHash('#/menu/profile')).toEqual({ kind: 'menu', section: 'agent' });
    expect(parseHash('#/menu/api')).toEqual({ kind: 'menu', section: 'models' });
    expect(parseHash('#/menu/local')).toEqual({ kind: 'menu', section: 'models' });
    expect(parseHash('#/menu/usage')).toEqual({ kind: 'menu', section: 'settings' });
    expect(parseHash('#/menu/workspace')).toEqual({ kind: 'menu', section: 'settings' });
    expect(parseHash('#/menu/gallery')).toEqual({ kind: 'menu', section: 'settings' });
  });

  it('falls back to default for unknown heads', () => {
    expect(parseHash('#/random/path')).toEqual(DEFAULT_ROUTE);
  });

  it('round-trips through format → parse', () => {
    const cases = [
      { kind: 'thread' as const, threadId: 'abc' },
    { kind: 'thread' as const, threadId: null },
    { kind: 'menu' as const,   section: 'models' as const },
    { kind: 'menu' as const,   section: 'agent' as const },
    { kind: 'menu' as const,   section: 'settings' as const },
    ];
    for (const r of cases) expect(parseHash(formatHash(r))).toEqual(r);
  });
});
