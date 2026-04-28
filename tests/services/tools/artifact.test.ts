import { describe, expect, it, vi } from 'vitest';
import { artifactTool } from '../../../src/services/tools/artifact';

function ctx(facade: any, threadId = 't1') {
  return { profile: {}, chat: {}, threadId, artifacts: facade } as any;
}

describe('artifact tool', () => {
  it('create returns artifact ref + content string', async () => {
    const create = vi.fn(async () => ({ id: 'demo-aaaaaa', version: 1 }));
    const result = await artifactTool.execute({ action: 'create', title: 'Demo', html: '<h1>hi</h1>' }, ctx({ create, update: vi.fn() }));
    if (typeof result === 'string') throw new Error('expected structured result');
    expect(result.artifacts).toEqual([{ kind: 'artifact', id: 'demo-aaaaaa', version: 1 }]);
    expect(result.content).toMatch(/Created artifact demo-aaaaaa/);
    expect(create).toHaveBeenCalledWith({ title: 'Demo', html: '<h1>hi</h1>', threadId: 't1', originMessageId: undefined });
  });

  it('update calls the facade and returns new version', async () => {
    const update = vi.fn(async () => ({ id: 'x', version: 3 }));
    const result = await artifactTool.execute({ action: 'update', artifact_id: 'x', html: 'v3', change_note: 'tweaks' }, ctx({ create: vi.fn(), update }));
    if (typeof result === 'string') throw new Error('expected structured result');
    expect(result.artifacts).toEqual([{ kind: 'artifact', id: 'x', version: 3 }]);
    expect(update).toHaveBeenCalledWith({ id: 'x', html: 'v3', changeNote: 'tweaks' });
  });

  it('rejects html over 1 MB', async () => {
    const create = vi.fn();
    const big = 'x'.repeat(1_000_001);
    const result = await artifactTool.execute({ action: 'create', title: 'Big', html: big }, ctx({ create, update: vi.fn() }));
    expect(typeof result === 'string' ? result : result.content).toMatch(/too large/i);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects unknown action / missing fields with a friendly error', async () => {
    const r1 = await artifactTool.execute({ action: 'create', html: '<p/>' } as any, ctx({ create: vi.fn(), update: vi.fn() }));
    expect(typeof r1 === 'string' ? r1 : r1.content).toMatch(/title/i);
    const r2 = await artifactTool.execute({ action: 'update', html: 'x' } as any, ctx({ create: vi.fn(), update: vi.fn() }));
    expect(typeof r2 === 'string' ? r2 : r2.content).toMatch(/artifact_id/i);
  });
});
