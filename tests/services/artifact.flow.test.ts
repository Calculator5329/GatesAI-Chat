/**
 * MANUAL SMOKE TEST CHECKLIST (run against a live app + bridge):
 *
 * 1. Start the bridge + dev server.
 * 2. In a chat: "Build me a small click counter as an artifact." Confirm the model
 *    calls `artifact { action: 'create' }` and a card renders.
 * 3. Click in the iframe, increment counter — works.
 * 4. Ask: "Update it so the count starts at 10." Card should update to v2 (version pill changes).
 * 5. In iframe DevTools: `await window.gates.readFile('/workspace/notes/<some-existing>')` resolves.
 * 6. `await window.gates.writeFile('/workspace/notes/escape.md', 'x')` rejects with "writes restricted…".
 * 7. `await window.gates.writeFile('/workspace/artifacts/<id>/data/state.json', '{}')` succeeds.
 * 8. Click Download .html, Open in browser, Expand — all work.
 * 9. Refresh app, reopen the same thread — card rehydrates from disk.
 */
import { describe, expect, it, vi } from 'vitest';
import { toolRegistry } from '../../src/services/tools/registry';
import { ArtifactStore } from '../../src/stores/ArtifactStore';
import { ArtifactStorage } from '../../src/services/artifactStorage';
import { ARTIFACT_PREAMBLE } from '../../src/components/editorial/artifactBridge';

function makeFakeBridge() {
  const files = new Map<string, string>();
  const client = {
    request: vi.fn(async (op: string, data: unknown) => {
      const d = data as { path?: string; content?: string };
      if (op === 'fs.write') { files.set(d.path!, d.content!); return { path: d.path, bytes: d.content!.length }; }
      if (op === 'fs.read')  { const c = files.get(d.path!); if (c == null) throw new Error('ENOENT'); return { path: d.path, content: c, mime: 'text/plain', size: c.length }; }
      if (op === 'fs.mkdir') return { path: d.path };
      throw new Error(`unexpected op ${op}`);
    }),
  };
  return { files, bridge: { isOnline: true, client } as any };
}

describe('artifact end-to-end flow', () => {
  it('create → persist → hydrate → render srcdoc', async () => {
    const { bridge, files } = makeFakeBridge();
    const storage = new ArtifactStorage(bridge);
    const store = new ArtifactStore(storage);

    const ctx: any = {
      profile: {}, chat: {}, threadId: 't1',
      artifacts: {
        async create(i: any) { const m = await store.create(i); return { id: m.id, version: m.currentVersion }; },
        async update(i: any) { const m = await store.update(i.id, i.html, i.changeNote); return m ? { id: m.id, version: m.currentVersion } : null; },
      },
    };

    const result = await toolRegistry.execute('artifact', { action: 'create', title: 'Counter', html: '<button>+1</button>' }, ctx);
    expect(result.artifacts?.[0]).toMatchObject({ kind: 'artifact', version: 1 });
    const id = (result.artifacts![0] as any).id as string;

    // Round-trip via a fresh store reading from the same fake bridge
    const fresh = new ArtifactStore(new ArtifactStorage(bridge));
    const meta = await fresh.hydrate(id);
    expect(meta?.title).toBe('Counter');
    const html = await fresh.getHtml(id, 1);
    expect(html).toBe('<button>+1</button>');

    // What the card would render
    const srcdoc = ARTIFACT_PREAMBLE + html!;
    expect(srcdoc).toContain('window.gates');
    expect(srcdoc).toContain('<button>+1</button>');

    // Update bumps version
    const upd = await toolRegistry.execute('artifact', { action: 'update', artifact_id: id, html: '<button>+2</button>', change_note: 'bigger' }, ctx);
    expect((upd.artifacts![0] as any).version).toBe(2);
    expect(files.get(`/workspace/artifacts/${id}/v2.html`)).toBe('<button>+2</button>');
  });
});
