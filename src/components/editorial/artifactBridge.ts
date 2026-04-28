import { isArtifactDataPath } from '../../core/artifacts';
import type { BridgeFacade } from '../../services/tools/types';
import type { FsListResp, FsReadResp } from '../../core/workspace';

export interface BridgeRequest {
  id: string;
  op: 'readFile' | 'listDir' | 'writeFile';
  args: unknown[];
}

export interface BridgeResponse {
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
}

export async function handleArtifactBridgeRequest(
  artifactId: string,
  bridge: BridgeFacade | undefined,
  req: BridgeRequest,
): Promise<BridgeResponse> {
  if (!bridge?.isOnline) return fail(req.id, 'bridge offline');
  try {
    if (req.op === 'readFile') {
      const path = String(req.args[0] ?? '');
      if (!path) return fail(req.id, 'path required');
      const resp = await bridge.client.request<FsReadResp>('fs.read', { path });
      return { id: req.id, ok: true, value: resp.content };
    }
    if (req.op === 'listDir') {
      const path = String(req.args[0] ?? '');
      if (!path) return fail(req.id, 'path required');
      const resp = await bridge.client.request<FsListResp>('fs.list', { path });
      return { id: req.id, ok: true, value: (resp.entries ?? []).map(e => e.path) };
    }
    if (req.op === 'writeFile') {
      const path = String(req.args[0] ?? '');
      const content = String(req.args[1] ?? '');
      if (!isArtifactDataPath(artifactId, path)) {
        return fail(req.id, `writes restricted to /workspace/artifacts/${artifactId}/data/`);
      }
      await bridge.client.request('fs.write', { path, content, encoding: 'utf8' });
      return { id: req.id, ok: true };
    }
    return fail(req.id, `unknown op ${(req as { op: string }).op}`);
  } catch (err) {
    return fail(req.id, (err as Error).message);
  }
}

function fail(id: string, error: string): BridgeResponse {
  return { id, ok: false, error };
}

/** The script we inject into every artifact iframe. Sets up window.gates. */
export const ARTIFACT_PREAMBLE = `
<script>
(function () {
  const pending = new Map();
  let seq = 0;
  function call(op, args) {
    const id = 'r' + (++seq);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      parent.postMessage({ __gates: true, id, op, args }, '*');
    });
  }
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || !d.__gatesResp) return;
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.ok) p.resolve(d.value); else p.reject(new Error(d.error || 'gates error'));
  });
  window.gates = {
    readFile: (path) => call('readFile', [path]),
    listDir:  (path) => call('listDir',  [path]),
    writeFile: (path, content) => call('writeFile', [path, content]),
  };
})();
</script>
`;
