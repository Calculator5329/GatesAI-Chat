# HTML Artifacts Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an `artifact` tool that lets the model emit interactive single-file HTML/CSS/JS pages, render them inline in chat as a sandboxed iframe card, persist them under `workspace/artifacts/<id>/`, and support versioned updates plus a `window.gates` postMessage bridge to the workspace.

**Architecture:**
- Storage on disk via the existing bridge `fs` ops (no new bridge endpoints).
- New `ArtifactStore` (MobX) mirrors `ImageJobStore`'s shape; backs in-session state and writes through to disk.
- New `ArtifactCard` renders a sandboxed `<iframe srcdoc>` with a host-side postMessage router for `gates.readFile/listDir/writeFile` (write scoped to the artifact's `data/` folder).
- Tool result carries a new `ToolResultArtifact { kind: 'artifact', id, version }`; `EditorialMessage` adds a render branch that mounts `ArtifactCard`.

**Tech Stack:** TypeScript, React, MobX (`mobx-react-lite`), Vitest, Tauri 2 (host shell-open + temp dir), existing bridge `fs.read/fs.write/fs.list/fs.mkdir`.

**Reference patterns to copy:**
- `src/services/tools/imageGenerate.ts` — tool shape, dispatching to a store
- `src/stores/ImageJobStore.ts` — store shape, persistence wiring
- `src/services/imageJobsStorage.ts` + `src/services/imageGenStorage.ts` — localStorage + workspace-disk persistence split
- `src/components/editorial/ImageJobCard.tsx` — card structure + Lightbox integration
- `src/components/editorial/EditorialMessage.tsx:139–155` — artifact render branch in tool results

---

## Task 1: Core types — `ToolResultArtifact` discriminator

**Files:**
- Modify: `src/core/types.ts:77-90`

**Step 1:** Extend the `ToolResultArtifact` union with a third variant:

```ts
| {
    kind: 'artifact';
    /** Reference into ArtifactStore (also the on-disk folder under /workspace/artifacts/). */
    id: string;
    /** Which version of the artifact to display (1-based, monotonically increasing). */
    version: number;
  };
```

**Step 2:** `npx tsc --noEmit` — expect zero new errors. Add the case to `EditorialMessage` later (Task 9) so deferring the unknown branch is fine for now (current code uses `if (kind === ...) return …; return null`).

**Step 3:** Commit.

```bash
git add src/core/types.ts
git commit -m "types: add 'artifact' variant to ToolResultArtifact"
```

---

## Task 2: Artifact metadata model + path helpers

**Files:**
- Create: `src/core/artifacts.ts`
- Test: `tests/core/artifacts.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { artifactDir, artifactVersionPath, artifactDataDir, artifactMetaPath, makeArtifactId, isArtifactDataPath } from '../../src/core/artifacts';

describe('artifact path helpers', () => {
  it('builds canonical /workspace paths from id', () => {
    expect(artifactDir('pomodoro-a1b2c3')).toBe('/workspace/artifacts/pomodoro-a1b2c3');
    expect(artifactMetaPath('pomodoro-a1b2c3')).toBe('/workspace/artifacts/pomodoro-a1b2c3/meta.json');
    expect(artifactVersionPath('pomodoro-a1b2c3', 2)).toBe('/workspace/artifacts/pomodoro-a1b2c3/v2.html');
    expect(artifactDataDir('pomodoro-a1b2c3')).toBe('/workspace/artifacts/pomodoro-a1b2c3/data');
  });

  it('makes ids that combine title slug and 6-char nanoid', () => {
    const id = makeArtifactId('My Cool Demo!');
    expect(id).toMatch(/^my-cool-demo-[a-z0-9]{6}$/);
  });

  it('falls back to "artifact" when title slug is empty', () => {
    expect(makeArtifactId('!!!')).toMatch(/^artifact-[a-z0-9]{6}$/);
  });

  it('isArtifactDataPath only accepts paths inside the artifact data dir', () => {
    expect(isArtifactDataPath('foo', '/workspace/artifacts/foo/data/x.json')).toBe(true);
    expect(isArtifactDataPath('foo', '/workspace/artifacts/foo/data/sub/x.json')).toBe(true);
    expect(isArtifactDataPath('foo', '/workspace/artifacts/foo/v1.html')).toBe(false);
    expect(isArtifactDataPath('foo', '/workspace/artifacts/bar/data/x.json')).toBe(false);
    expect(isArtifactDataPath('foo', '/workspace/artifacts/foo/data/../../escape')).toBe(false);
  });
});
```

**Step 2:** Run `npx vitest run tests/core/artifacts.test.ts` — expect FAIL (module not found).

**Step 3: Implement**

```ts
// src/core/artifacts.ts

export interface ArtifactVersion {
  version: number;
  createdAt: number;
  changeNote?: string;
  /** Bytes on disk (UTF-8) — handy for budget displays. */
  size: number;
}

export interface ArtifactMeta {
  id: string;
  title: string;
  slug: string;
  createdAt: number;
  updatedAt: number;
  threadId: string;
  originMessageId?: string;
  currentVersion: number;
  versions: ArtifactVersion[];
}

const NANOID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function makeArtifactId(title: string): string {
  const slug = slugify(title) || 'artifact';
  let suffix = '';
  const arr = new Uint32Array(6);
  crypto.getRandomValues(arr);
  for (const n of arr) suffix += NANOID_ALPHABET[n % NANOID_ALPHABET.length];
  return `${slug.slice(0, 30)}-${suffix}`;
}

export function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function artifactDir(id: string): string {
  return `/workspace/artifacts/${id}`;
}
export function artifactMetaPath(id: string): string {
  return `${artifactDir(id)}/meta.json`;
}
export function artifactVersionPath(id: string, version: number): string {
  return `${artifactDir(id)}/v${version}.html`;
}
export function artifactDataDir(id: string): string {
  return `${artifactDir(id)}/data`;
}

/** Validate that a /workspace path stays inside this artifact's data folder. */
export function isArtifactDataPath(id: string, path: string): boolean {
  const norm = normalizeWorkspacePath(path);
  if (!norm) return false;
  if (norm.includes('..')) return false;
  const prefix = `${artifactDataDir(id)}/`;
  return norm === artifactDataDir(id) || norm.startsWith(prefix);
}

function normalizeWorkspacePath(p: string): string | null {
  if (typeof p !== 'string' || !p) return null;
  let s = p.replace(/\\/g, '/');
  if (!s.startsWith('/workspace')) s = `/workspace/${s.replace(/^\/+/, '')}`;
  // collapse `.` segments but preserve `..` so isArtifactDataPath can reject them
  const parts = s.split('/').filter((seg, i) => seg !== '.' && (i === 0 || seg !== ''));
  return parts.join('/').replace(/\/+/g, '/');
}
```

**Step 4:** Re-run the test — expect PASS.

**Step 5:** Commit.

```bash
git add src/core/artifacts.ts tests/core/artifacts.test.ts
git commit -m "core: artifact path helpers and id generator"
```

---

## Task 3: Disk persistence layer (`artifactStorage.ts`)

**Files:**
- Create: `src/services/artifactStorage.ts`
- Test: `tests/services/artifactStorage.test.ts`

This module is bridge-aware: it serializes meta.json and html bytes via the existing `bridge.client.request('fs.write' / 'fs.read' / 'fs.mkdir')` calls. Don't duplicate path validation — reuse helpers from Task 2.

**Step 1: Write the failing test** (use a fake `BridgeFacade` that records calls):

```ts
import { describe, expect, it, vi } from 'vitest';
import { ArtifactStorage } from '../../src/services/artifactStorage';
import type { ArtifactMeta } from '../../src/core/artifacts';

function makeFakeBridge() {
  const calls: { op: string; data: unknown }[] = [];
  const files = new Map<string, string>();
  const client = {
    request: vi.fn(async (op: string, data: unknown) => {
      calls.push({ op, data });
      const d = data as { path?: string; content?: string };
      if (op === 'fs.write') { files.set(d.path!, d.content!); return { path: d.path, bytes: d.content!.length }; }
      if (op === 'fs.read')  { const c = files.get(d.path!); if (c == null) throw new Error('ENOENT'); return { path: d.path, content: c, mime: 'text/plain', size: c.length }; }
      if (op === 'fs.mkdir') return { path: d.path };
      if (op === 'fs.list')  return { path: d.path, entries: [], truncated: false };
      throw new Error(`unexpected op ${op}`);
    }),
  };
  return { calls, files, bridge: { isOnline: true, client } as any };
}

describe('ArtifactStorage', () => {
  it('writeNewVersion creates folder, writes html and meta', async () => {
    const { bridge, files, calls } = makeFakeBridge();
    const storage = new ArtifactStorage(bridge);
    const meta: ArtifactMeta = {
      id: 'foo-abc123', title: 'Foo', slug: 'foo',
      createdAt: 1, updatedAt: 1, threadId: 't1',
      currentVersion: 1, versions: [{ version: 1, createdAt: 1, size: 12 }],
    };
    await storage.writeNewVersion(meta, '<html>hi</html>');
    expect(files.get('/workspace/artifacts/foo-abc123/v1.html')).toBe('<html>hi</html>');
    const persistedMeta = JSON.parse(files.get('/workspace/artifacts/foo-abc123/meta.json')!);
    expect(persistedMeta.id).toBe('foo-abc123');
    expect(calls.some(c => c.op === 'fs.mkdir' && (c.data as any).path === '/workspace/artifacts/foo-abc123/data')).toBe(true);
  });

  it('readMeta parses meta.json or returns null if missing', async () => {
    const { bridge, files } = makeFakeBridge();
    const storage = new ArtifactStorage(bridge);
    expect(await storage.readMeta('missing')).toBeNull();
    files.set('/workspace/artifacts/x/meta.json', JSON.stringify({ id: 'x', title: 'X', slug: 'x', createdAt: 0, updatedAt: 0, threadId: 't', currentVersion: 1, versions: [] }));
    const got = await storage.readMeta('x');
    expect(got?.id).toBe('x');
  });

  it('readVersion returns html for a given version', async () => {
    const { bridge, files } = makeFakeBridge();
    const storage = new ArtifactStorage(bridge);
    files.set('/workspace/artifacts/x/v2.html', '<p>v2</p>');
    expect(await storage.readVersion('x', 2)).toBe('<p>v2</p>');
  });
});
```

**Step 2:** Run, expect FAIL.

**Step 3: Implement**

```ts
// src/services/artifactStorage.ts
import {
  artifactDataDir, artifactDir, artifactMetaPath, artifactVersionPath,
  type ArtifactMeta,
} from '../core/artifacts';
import type { BridgeFacade } from './tools/types';
import type { FsReadResp } from '../core/workspace';

export class ArtifactStorage {
  constructor(private readonly bridge: BridgeFacade) {}

  async writeNewVersion(meta: ArtifactMeta, html: string): Promise<void> {
    if (!this.bridge.isOnline) throw new Error('bridge offline');
    const c = this.bridge.client;
    await c.request('fs.mkdir', { path: artifactDir(meta.id) });
    await c.request('fs.mkdir', { path: artifactDataDir(meta.id) });
    await c.request('fs.write', {
      path: artifactVersionPath(meta.id, meta.currentVersion),
      content: html, encoding: 'utf8',
    });
    await c.request('fs.write', {
      path: artifactMetaPath(meta.id),
      content: JSON.stringify(meta, null, 2), encoding: 'utf8',
    });
  }

  async readMeta(id: string): Promise<ArtifactMeta | null> {
    if (!this.bridge.isOnline) return null;
    try {
      const resp = await this.bridge.client.request<FsReadResp>('fs.read', { path: artifactMetaPath(id) });
      return JSON.parse(resp.content) as ArtifactMeta;
    } catch {
      return null;
    }
  }

  async readVersion(id: string, version: number): Promise<string | null> {
    if (!this.bridge.isOnline) return null;
    try {
      const resp = await this.bridge.client.request<FsReadResp>('fs.read', { path: artifactVersionPath(id, version) });
      return resp.content;
    } catch {
      return null;
    }
  }
}
```

**Step 4:** Re-run — expect PASS.

**Step 5:** Commit.

```bash
git add src/services/artifactStorage.ts tests/services/artifactStorage.test.ts
git commit -m "services: ArtifactStorage disk persistence"
```

---

## Task 4: `ArtifactStore` (MobX)

**Files:**
- Create: `src/stores/ArtifactStore.ts`
- Test: `tests/stores/ArtifactStore.test.ts`

Mirror the surface of `ImageJobStore`: in-memory map of meta + cached html, observable, with `create`, `update`, `findById`, `getHtml`, and a `hydrate` that lazy-reads meta from disk on first access. We do NOT keep an index in localStorage — meta.json on disk is the source of truth, and the chat message carries the id.

**Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { ArtifactStore } from '../../src/stores/ArtifactStore';
import type { ArtifactStorage } from '../../src/services/artifactStorage';
import type { ArtifactMeta } from '../../src/core/artifacts';

function makeFakeStorage() {
  const writes: { meta: ArtifactMeta; html: string }[] = [];
  const metas = new Map<string, ArtifactMeta>();
  const versions = new Map<string, string>();
  const storage = {
    writeNewVersion: async (meta: ArtifactMeta, html: string) => {
      writes.push({ meta, html });
      metas.set(meta.id, JSON.parse(JSON.stringify(meta)));
      versions.set(`${meta.id}:${meta.currentVersion}`, html);
    },
    readMeta: async (id: string) => metas.get(id) ?? null,
    readVersion: async (id: string, v: number) => versions.get(`${id}:${v}`) ?? null,
  } as unknown as ArtifactStorage;
  return { storage, writes, metas, versions };
}

describe('ArtifactStore', () => {
  it('create assigns an id and writes v1', async () => {
    const { storage, writes } = makeFakeStorage();
    const store = new ArtifactStore(storage);
    const meta = await store.create({ title: 'Hi', html: '<p>1</p>', threadId: 't1', originMessageId: 'm1' });
    expect(meta.currentVersion).toBe(1);
    expect(writes).toHaveLength(1);
    expect(writes[0].html).toBe('<p>1</p>');
    expect(store.findById(meta.id)?.title).toBe('Hi');
    expect(await store.getHtml(meta.id, 1)).toBe('<p>1</p>');
  });

  it('update bumps version and persists, keeping prior versions', async () => {
    const { storage } = makeFakeStorage();
    const store = new ArtifactStore(storage);
    const a = await store.create({ title: 'X', html: 'v1', threadId: 't' });
    const updated = await store.update(a.id, 'v2', 'tweaked');
    expect(updated?.currentVersion).toBe(2);
    expect(updated?.versions.map(v => v.version)).toEqual([1, 2]);
    expect(await store.getHtml(a.id, 1)).toBe('v1');
    expect(await store.getHtml(a.id, 2)).toBe('v2');
  });

  it('findById hydrates from disk on first access', async () => {
    const { storage, metas, versions } = makeFakeStorage();
    metas.set('preexisting', { id: 'preexisting', title: 'P', slug: 'p', createdAt: 0, updatedAt: 0, threadId: 't', currentVersion: 1, versions: [{ version: 1, createdAt: 0, size: 2 }] });
    versions.set('preexisting:1', 'hi');
    const store = new ArtifactStore(storage);
    expect(store.findById('preexisting')).toBeNull(); // not yet hydrated
    await store.hydrate('preexisting');
    expect(store.findById('preexisting')?.title).toBe('P');
  });
});
```

**Step 2:** Run, expect FAIL.

**Step 3: Implement**

```ts
// src/stores/ArtifactStore.ts
import { makeAutoObservable, runInAction } from 'mobx';
import type { ArtifactStorage } from '../services/artifactStorage';
import {
  makeArtifactId, slugify,
  type ArtifactMeta, type ArtifactVersion,
} from '../core/artifacts';

interface CreateInput {
  title: string;
  html: string;
  threadId: string;
  originMessageId?: string;
}

export class ArtifactStore {
  /** id → meta. Hydrated on demand from disk. */
  private metas = new Map<string, ArtifactMeta>();
  /** `${id}:${version}` → html. Lazy-loaded; not all versions live here. */
  private htmlCache = new Map<string, string>();

  constructor(private readonly storage: ArtifactStorage) {
    makeAutoObservable<this, 'storage'>(this, { storage: false }, { autoBind: true });
  }

  findById(id: string): ArtifactMeta | null {
    return this.metas.get(id) ?? null;
  }

  async hydrate(id: string): Promise<ArtifactMeta | null> {
    const cached = this.metas.get(id);
    if (cached) return cached;
    const meta = await this.storage.readMeta(id);
    if (!meta) return null;
    runInAction(() => { this.metas.set(id, meta); });
    return meta;
  }

  async getHtml(id: string, version: number): Promise<string | null> {
    const key = `${id}:${version}`;
    const cached = this.htmlCache.get(key);
    if (cached != null) return cached;
    const html = await this.storage.readVersion(id, version);
    if (html == null) return null;
    runInAction(() => { this.htmlCache.set(key, html); });
    return html;
  }

  async create(input: CreateInput): Promise<ArtifactMeta> {
    const id = makeArtifactId(input.title);
    const now = Date.now();
    const v: ArtifactVersion = { version: 1, createdAt: now, size: input.html.length };
    const meta: ArtifactMeta = {
      id, title: input.title, slug: slugify(input.title) || 'artifact',
      createdAt: now, updatedAt: now,
      threadId: input.threadId, originMessageId: input.originMessageId,
      currentVersion: 1, versions: [v],
    };
    await this.storage.writeNewVersion(meta, input.html);
    runInAction(() => {
      this.metas.set(id, meta);
      this.htmlCache.set(`${id}:1`, input.html);
    });
    return meta;
  }

  async update(id: string, html: string, changeNote?: string): Promise<ArtifactMeta | null> {
    const existing = await this.hydrate(id);
    if (!existing) return null;
    const nextVersion = existing.currentVersion + 1;
    const now = Date.now();
    const v: ArtifactVersion = { version: nextVersion, createdAt: now, size: html.length, changeNote };
    const next: ArtifactMeta = {
      ...existing,
      updatedAt: now,
      currentVersion: nextVersion,
      versions: [...existing.versions, v],
    };
    await this.storage.writeNewVersion(next, html);
    runInAction(() => {
      this.metas.set(id, next);
      this.htmlCache.set(`${id}:${nextVersion}`, html);
    });
    return next;
  }
}
```

**Step 4:** Re-run — PASS.

**Step 5:** Commit.

```bash
git add src/stores/ArtifactStore.ts tests/stores/ArtifactStore.test.ts
git commit -m "stores: ArtifactStore with hydrate / create / update"
```

---

## Task 5: Wire `ArtifactStore` into the root store + React context

**Files:**
- Modify: `src/stores/RootStore.ts`
- Modify: `src/stores/context.tsx`

**Step 1:** Read `src/stores/RootStore.ts` — note how `ImageJobStore` is constructed (it takes the bridge / persistence dependencies). Construct `ArtifactStore` similarly: pass a new `ArtifactStorage(this.bridge)` instance.

**Step 2:** Add the store to the root: `readonly artifacts = new ArtifactStore(new ArtifactStorage(this.bridge));` (place near `imageJobs`).

**Step 3:** In `src/stores/context.tsx`, add `useArtifactStore` mirroring `useImageJobStore`.

**Step 4:** `npx tsc --noEmit`. Run the existing store test suites to confirm nothing regressed: `npx vitest run tests/stores`.

**Step 5:** Commit.

```bash
git add src/stores/RootStore.ts src/stores/context.tsx
git commit -m "stores: register ArtifactStore in root + context hook"
```

---

## Task 6: Add `ArtifactsFacade` to `ToolContext`

**Files:**
- Modify: `src/services/tools/types.ts`
- Modify: wherever `ToolContext` is built (search for `imageJobs:` to find it — likely `src/services/chat/` or `src/stores/ChatStore.ts`)

**Step 1:** Add to `types.ts`:

```ts
export interface ArtifactsFacade {
  create(input: { title: string; html: string; threadId: string; originMessageId?: string }):
    Promise<{ id: string; version: number }>;
  update(input: { id: string; html: string; changeNote?: string }):
    Promise<{ id: string; version: number } | null>;
}
```

Add `artifacts?: ArtifactsFacade;` to `ToolContext`.

**Step 2:** Find the call site that constructs `ToolContext` (`grep -n "imageJobs:" src/`) and pass `artifacts: rootStore.artifacts` through using the same pattern. The facade implementation is a thin wrapper:

```ts
artifacts: {
  async create(i) { const m = await rootStore.artifacts.create(i); return { id: m.id, version: m.currentVersion }; },
  async update(i) { const m = await rootStore.artifacts.update(i.id, i.html, i.changeNote); return m ? { id: m.id, version: m.currentVersion } : null; },
},
```

**Step 3:** `npx tsc --noEmit`.

**Step 4:** Commit.

```bash
git add src/services/tools/types.ts src/...
git commit -m "tools: ArtifactsFacade on ToolContext"
```

---

## Task 7: The `artifact` tool

**Files:**
- Create: `src/services/tools/artifact.ts`
- Test: `tests/services/tools/artifact.test.ts`
- Modify: `src/services/tools/registry.ts`

**Tool contract:**

```ts
{
  action: 'create' | 'update',
  // create
  title?: string,
  html?: string,
  summary?: string,
  // update
  artifact_id?: string,
  change_note?: string,
}
```

Returns to the model: `Created artifact <id> v1: <title>. <summary or "">` / `Updated <id> to v<n>.`. Returns `artifacts: [{ kind: 'artifact', id, version }]` to the UI.

**Validation:** non-empty html, `html.length <= 1_000_000` (1 MB cap; otherwise return an error string the model can read and self-correct).

**Always-on:** add `'artifact'` to the unconditionally-selected set in `toolDefsForTurn` (sibling of `'memory'`, `'thread'`).

**Step 1: Write the failing test**

```ts
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
```

**Step 2:** Run — FAIL.

**Step 3: Implement** `src/services/tools/artifact.ts`. Description (verbatim — model-facing):

```
artifact — emit a self-contained interactive HTML page that renders inline in the chat.

Use this when the user asks for a page, widget, calculator, mini-tool, visualization, demo, dashboard, or anything they can click on. Single-file HTML only: inline <style> and <script>, optional CDN imports. The page renders inside a sandboxed iframe; you have NO access to host cookies or storage, but `window.gates` is available for workspace I/O:

  await window.gates.readFile(path)            // any /workspace path
  await window.gates.listDir(path)             // any /workspace path
  await window.gates.writeFile(path, content)  // only inside this artifact's data folder

Actions:
• `create` — { title, html, summary? }. Returns artifact_id + v1.
• `update` — { artifact_id, html, change_note? }. Bumps to v(n+1). Always pass the FULL replacement html.

Constraints: html ≤ 1,000,000 chars. After calling, do NOT paste the html back into chat — the user already sees the rendered card.
```

Skeleton:

```ts
export const artifactTool: Tool = {
  def: { name: 'artifact', description: '…', parameters: { type: 'object', properties: { /* … */ }, required: ['action'] } },
  meta: { category: 'workspace', resultPolicy: { maxChars: 500 }, hasSideEffects: () => true },
  async execute(args, ctx) {
    if (!ctx.artifacts) return 'Error: artifacts unavailable in this context.';
    const action = String(args.action ?? '');
    const html = typeof args.html === 'string' ? args.html : '';
    if (html.length > 1_000_000) return `Error: html too large (${html.length} chars; max 1,000,000).`;
    if (!html) return 'Error: `html` is required.';
    if (action === 'create') {
      const title = typeof args.title === 'string' ? args.title.trim() : '';
      if (!title) return 'Error: `title` is required for create.';
      const ref = await ctx.artifacts.create({ title, html, threadId: ctx.threadId });
      const summary = typeof args.summary === 'string' ? ` ${args.summary.trim()}` : '';
      return { content: `Created artifact ${ref.id} v${ref.version}: ${title}.${summary}`,
               artifacts: [{ kind: 'artifact', id: ref.id, version: ref.version }] };
    }
    if (action === 'update') {
      const id = typeof args.artifact_id === 'string' ? args.artifact_id : '';
      if (!id) return 'Error: `artifact_id` is required for update.';
      const changeNote = typeof args.change_note === 'string' ? args.change_note : undefined;
      const ref = await ctx.artifacts.update({ id, html, changeNote });
      if (!ref) return `Error: artifact ${id} not found.`;
      return { content: `Updated artifact ${ref.id} to v${ref.version}.${changeNote ? ' ' + changeNote : ''}`,
               artifacts: [{ kind: 'artifact', id: ref.id, version: ref.version }] };
    }
    return `Error: unknown action "${action}". Valid: create, update.`;
  },
};
```

**Step 4:** Register in `src/services/tools/registry.ts`:
- Import `artifactTool`.
- `toolRegistry.register(artifactTool);` near the bottom.
- In `toolDefsForTurn`, add `'artifact'` to the initial `selected` set so it's always-on.

**Step 5:** Run the new test + the registry tests: `npx vitest run tests/services/tools`.

**Step 6:** Commit.

```bash
git add src/services/tools/artifact.ts src/services/tools/registry.ts tests/services/tools/artifact.test.ts
git commit -m "tools: artifact tool (create/update) + always-on registration"
```

---

## Task 8: Workspace bridge — host-side postMessage router

**Files:**
- Create: `src/components/editorial/artifactBridge.ts`
- Test: `tests/components/editorial/artifactBridge.test.ts`

This module owns the host half of `window.gates`. The iframe sends `{ id, op, args }`, we route it to the bridge's `fs.read/list/write`, and post `{ id, ok, value }` or `{ id, ok: false, error }` back. Writes are restricted to `isArtifactDataPath(artifactId, path)`.

**Step 1: Test** — drives a fake bridge + a fake `MessageEvent` and asserts:
- `readFile('/workspace/notes/x.md')` calls `fs.read` and resolves with the content.
- `listDir('/workspace/artifacts/foo/data')` calls `fs.list` and returns string[] of paths.
- `writeFile('/workspace/artifacts/foo/data/state.json', '{}')` for matching `artifactId` succeeds.
- `writeFile('/workspace/notes/foo.md', 'hi')` for `artifactId='foo'` rejects with "writes restricted…".
- Unknown `op` returns an error frame.

**Step 2:** Run — FAIL.

**Step 3: Implement**

```ts
// src/components/editorial/artifactBridge.ts
import { isArtifactDataPath } from '../../core/artifacts';
import type { BridgeFacade } from '../../services/tools/types';
import type { FsListResp, FsReadResp } from '../../core/workspace';

export interface BridgeRequest { id: string; op: 'readFile' | 'listDir' | 'writeFile'; args: unknown[] }
export interface BridgeResponse { id: string; ok: boolean; value?: unknown; error?: string }

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
    return fail(req.id, `unknown op ${(req as any).op}`);
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
```

**Step 4:** Re-run — PASS.

**Step 5:** Commit.

```bash
git add src/components/editorial/artifactBridge.ts tests/components/editorial/artifactBridge.test.ts
git commit -m "editorial: artifact bridge router + iframe preamble"
```

---

## Task 9: `ArtifactCard` component

**Files:**
- Create: `src/components/editorial/ArtifactCard.tsx`
- Test: `tests/components/editorial/ArtifactCard.test.ts`
- Modify: `src/components/editorial/EditorialMessage.tsx:139-155`

**Behavior:**
- On mount, calls `artifacts.hydrate(id)` then `artifacts.getHtml(id, version)`.
- Renders an iframe with `srcdoc = ARTIFACT_PREAMBLE + html`, `sandbox="allow-scripts allow-popups"`, `style={{ width:'100%', height:420, border:'1px solid var(--border)', borderRadius:8 }}`.
- Listens to `window` `message` events. For frames marked `__gates: true` AND coming from `iframeRef.current.contentWindow`, calls `handleArtifactBridgeRequest(id, bridge, frame)` and posts the response with `__gatesResp: true`.
- Header row: title + `v{version}` pill + buttons: **Expand**, **Open in browser**, **Download .html**.
- Expand: full-screen overlay (reuse `Lightbox`'s shell pattern — black backdrop, ESC to close — but render the same iframe full-window).
- Download: anchor with `href=data:text/html;base64,…` and `download="<slug>-v<n>.html"`.
- Open in browser: write the html to `workspace/artifacts/<id>/v<n>.html` (it's already there) and use Tauri's shell-open via `@tauri-apps/api/shell` `open()` or whatever pattern `WorkspaceImage` already uses for "open in OS". Search `grep -rn "shell" src/components` to find the precedent; if there isn't one, use `@tauri-apps/plugin-opener`'s `open()` if it's already a dep — check `package.json`.
- Loading / missing states: spinner placeholder while hydrating; "Lost track of artifact <id>" if hydrate returns null.

**Step 1: Test** focuses on:
- Renders an iframe whose `srcdoc` contains `window.gates` and the html body.
- Renders title + version pill.
- Clicking Expand toggles a full-screen container.
- A `MessageEvent` with `__gates:true` from the iframe's contentWindow triggers the router and posts a response.

**Step 2:** Run — FAIL.

**Step 3:** Implement. Key glue:

```tsx
const srcdoc = useMemo(() => html ? ARTIFACT_PREAMBLE + html : '', [html]);
useEffect(() => {
  function onMsg(ev: MessageEvent) {
    const data = ev.data;
    if (!data || !data.__gates) return;
    if (ev.source !== iframeRef.current?.contentWindow) return;
    handleArtifactBridgeRequest(id, bridge, data).then(resp => {
      iframeRef.current?.contentWindow?.postMessage({ __gatesResp: true, ...resp }, '*');
    });
  }
  window.addEventListener('message', onMsg);
  return () => window.removeEventListener('message', onMsg);
}, [id, bridge]);
```

**Step 4:** Update `EditorialMessage.tsx` artifact-render block to add:

```tsx
if (artifact.kind === 'artifact') {
  return (
    <div key={`art-${artifact.id}-${artifact.version}-${idx}`} style={{ marginTop: 8 }}>
      <ArtifactCard id={artifact.id} version={artifact.version} />
    </div>
  );
}
```

**Step 5:** Run all editorial tests: `npx vitest run tests/components/editorial`.

**Step 6:** Commit.

```bash
git add src/components/editorial/ArtifactCard.tsx src/components/editorial/EditorialMessage.tsx tests/components/editorial/ArtifactCard.test.ts
git commit -m "editorial: ArtifactCard with sandboxed iframe + gates bridge"
```

---

## Task 10: End-to-end smoke test (manual + automated)

**Files:**
- Test: `tests/integration/artifact.flow.test.ts`

**Step 1:** Integration-style test that drives the tool through registry + ArtifactStore + ArtifactStorage with a fake bridge, then renders `ArtifactCard` for the resulting id and asserts the iframe srcdoc contains both the preamble and the html.

**Step 2:** Manual smoke test against a running app (write the steps in the test file as comments AND in this plan):

1. Start the bridge + dev server.
2. In a chat: "Build me a small click counter as an artifact." Confirm the model calls `artifact { action: 'create' }` and a card renders.
3. Click in the iframe, increment counter — works.
4. Ask: "Update it so the count starts at 10." Card should update to v2 (version pill changes).
5. Inside the iframe DevTools, run `await window.gates.readFile('/workspace/notes')` (or an existing notes file path) — resolves successfully.
6. Run `await window.gates.writeFile('/workspace/notes/escape.md', 'x')` — rejects with "writes restricted…".
7. Run `await window.gates.writeFile('/workspace/artifacts/<id>/data/state.json', '{}')` — succeeds; check the file appears on disk.
8. Click **Download .html**, **Open in browser**, **Expand**.
9. Refresh the app, reopen the same thread — card rehydrates from disk and renders the latest version.

**Step 3:** Commit.

```bash
git add tests/integration/artifact.flow.test.ts docs/plans/2026-04-27-html-artifacts.md
git commit -m "test: artifact end-to-end flow + manual smoke checklist"
```

---

## Task 11: Docs touch-ups

**Files:**
- Modify: `docs/architecture.md` — add an "Artifacts" subsection under Tools / Workspace.
- Modify: `docs/changelog.md` — entry for the new tool.
- Modify: `docs/tech_spec.md` — extend the `ToolResultArtifact` enum docs.

Brief, factual prose. No marketing tone. Commit:

```bash
git add docs/architecture.md docs/changelog.md docs/tech_spec.md
git commit -m "docs: HTML artifacts tool"
```

---

## Verification gate (before declaring done)

Per @superpowers:verification-before-completion:

```bash
npx tsc --noEmit
npx vitest run
npm run lint  # if it exists in package.json
```

All must be green. Then run the manual smoke checklist from Task 10 in the live app.
