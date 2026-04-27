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
    expect(parseHash('#/menu/api'))  .toEqual({ kind: 'menu', section: 'api' });
    expect(parseHash('#/menu/local')).toEqual({ kind: 'menu', section: 'local' });
    expect(parseHash('#/menu'))      .toEqual({ kind: 'menu', section: 'profile' });
    expect(parseHash('#/menu/wat'))  .toEqual({ kind: 'menu', section: 'profile' });
  });

  it('falls back to default for unknown heads', () => {
    expect(parseHash('#/random/path')).toEqual(DEFAULT_ROUTE);
  });

  it('round-trips through format → parse', () => {
    const cases = [
      { kind: 'thread' as const, threadId: 'abc' },
      { kind: 'thread' as const, threadId: null },
      { kind: 'menu' as const,   section: 'usage' as const },
      { kind: 'menu' as const,   section: 'local' as const },
    ];
    for (const r of cases) expect(parseHash(formatHash(r))).toEqual(r);
  });
});
