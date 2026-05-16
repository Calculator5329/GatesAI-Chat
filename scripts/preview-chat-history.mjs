import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const mod = await import('../src/services/workspaceChatPersistence.ts');

// We need to call the internal renderers. They aren't exported, so we drive
// the whole save() flow against a fake bridge and inspect what it would write.
const files = new Map();
const fakeBridge = {
  async request(method, params) {
    switch (method) {
      case 'fs.mkdir': return {};
      case 'fs.write':
        files.set(params.path, params.content);
        return {};
      case 'fs.move':
        if (files.has(params.from)) {
          files.set(params.to, files.get(params.from));
          files.delete(params.from);
        }
        return {};
      case 'fs.read': {
        const content = files.get(params.path);
        if (content == null) throw new Error('not found');
        return { content };
      }
      default: return {};
    }
  },
};

const persistence = mod.createWorkspaceChatPersistence(fakeBridge);

const now = Date.now();
const dayMs = 24 * 60 * 60 * 1000;
const longContent = `Sure — here's a quick plan for building that game.

We'll set up a canvas at full window size, then drive a simple loop with requestAnimationFrame. Player movement reads from arrow keys (held state, not edges), and collectible stars get spawned at random positions outside a safety radius around the player.

\`\`\`js
const player = { x: 0, y: 0, r: 14, color: '#5b8cff' };
function tick(t) {
  // ...
  requestAnimationFrame(tick);
}
\`\`\`

The score lives in localStorage so the "best" survives a reload.`;

const threads = [
  {
    id: 't-mp3jie6veqhz',
    title: 'Building Web Games',
    subtitle: 'A neon-styled dodge game built end-to-end',
    summary: 'Worked through a neon-style HTML/Canvas dodge game. Player movement, collectibles, scoring, game-over flow, and a full-screen animated visual layer.',
    createdAt: now - 4 * 60 * 60 * 1000,
    updatedAt: now - 30 * 60 * 1000,
    deletedAt: null,
    messages: [
      { id: 'm1', role: 'user', content: 'make a cool html game', createdAt: now - 4 * 60 * 60 * 1000 },
      { id: 'm2', role: 'assistant', content: longContent, createdAt: now - 4 * 60 * 60 * 1000 + 30000 },
      { id: 'm3', role: 'user', content: 'add a high score that persists', createdAt: now - 3 * 60 * 60 * 1000 },
      { id: 'm4', role: 'assistant', content: 'Done — best score now lives in localStorage under "neon.best" and is shown next to the current score.', createdAt: now - 3 * 60 * 60 * 1000 + 18000 },
      { id: 'm5', role: 'user', content: 'make the stars sparkle', createdAt: now - 2 * 60 * 60 * 1000 },
      { id: 'm6', role: 'assistant', content: 'Stars now twinkle on a sin-wave with a small random phase per-star, so they don\'t pulse in unison. Looks more alive.', createdAt: now - 2 * 60 * 60 * 1000 + 22000 },
    ],
  },
  {
    id: 't-abc123',
    title: 'Polishing the chat history sidebar',
    subtitle: '',
    summary: '',
    createdAt: now - 26 * 60 * 60 * 1000,
    updatedAt: now - 24 * 60 * 60 * 1000,
    deletedAt: null,
    messages: [
      { id: 'm7', role: 'user', content: 'rethink the editorial sidebar', createdAt: now - 26 * 60 * 60 * 1000 },
      { id: 'm8', role: 'assistant', content: 'Three directions: editorial-refined, editorial-glass, notebook/margin.', createdAt: now - 26 * 60 * 60 * 1000 + 15000 },
    ],
  },
  {
    id: 't-xyz789',
    title: 'Refactoring the workspace bridge',
    subtitle: 'Threading and message workflows',
    summary: 'Split out persistence concerns and added a typed facade.',
    createdAt: now - 5 * dayMs,
    updatedAt: now - 3 * dayMs,
    deletedAt: null,
    messages: [
      { id: 'm9', role: 'user', content: 'extract a persistence facade', createdAt: now - 5 * dayMs },
      { id: 'm10', role: 'assistant', content: 'Introduced PersistenceProvider so the storage backend swaps cleanly between IndexedDB and the workspace bridge.', createdAt: now - 5 * dayMs + 20000 },
    ],
  },
  {
    id: 't-old1',
    title: 'Adding model selection',
    subtitle: '',
    summary: 'Pop-over model picker keyed by provider.',
    createdAt: now - 35 * dayMs,
    updatedAt: now - 32 * dayMs,
    deletedAt: null,
    messages: [
      { id: 'm11', role: 'user', content: 'we need a model picker', createdAt: now - 35 * dayMs },
      { id: 'm12', role: 'assistant', content: 'Built a popover grouped by provider with a search box and recent-models pinned at the top.', createdAt: now - 35 * dayMs + 20000 },
    ],
  },
];

const snapshot = { threads, activeThreadId: threads[0].id };
await persistence.save(snapshot);

const out = resolve('preview-output/chat-history');
mkdirSync(out, { recursive: true });
mkdirSync(resolve(out, 'conversations'), { recursive: true });
for (const [path, content] of files) {
  if (!path.startsWith('/workspace/chat-history/')) continue;
  const rel = path.slice('/workspace/chat-history/'.length);
  const dest = resolve(out, rel);
  mkdirSync(resolve(dest, '..'), { recursive: true });
  writeFileSync(dest, content);
  console.log('wrote', dest);
}
