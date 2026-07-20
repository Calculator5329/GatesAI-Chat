// Shared Playwright helpers: localStorage seeding + network/bridge mocking.
// These let browser specs run the real app deterministically without a live
// OpenRouter account or a running gatesai-bridge sidecar.
import type { Page, WebSocketRoute } from '@playwright/test';
import type { RetrievalTrace } from '../../../src/core/types';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const BRIDGE_HEALTH_URL = 'http://127.0.0.1:7331/health';
const BRIDGE_WS_URL = 'ws://127.0.0.1:7331/ws';
const OLLAMA_BASE_URL = 'http://127.0.0.1:11434';

// A visibly rendered image for bridge-backed image reads. The old fixture was
// a fully transparent 1x1 PNG: <img> visibility assertions passed, but every
// gallery and lightbox capture looked black against the app background.
const VISIBLE_IMAGE_SVG_BASE64 =
  'PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSI2NCIgaGVpZ2h0PSI2NCIgdmlld0JveD0iMCAwIDY0IDY0Ij48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImciIHgxPSIwIiB5MT0iMCIgeDI9IjEiIHkyPSIxIj48c3RvcCBzdG9wLWNvbG9yPSIjMjdkMTdmIi8+PHN0b3Agb2Zmc2V0PSIxIiBzdG9wLWNvbG9yPSIjNDg2Y2ZmIi8+PC9saW5lYXJHcmFkaWVudD48L2RlZnM+PHJlY3Qgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0IiBmaWxsPSJ1cmwoI2cpIi8+PGNpcmNsZSBjeD0iMzIiIGN5PSIzMiIgcj0iMTQiIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iLjg1Ii8+PC9zdmc+';

// ── localStorage seeding ─────────────────────────────────────────────────
// addInitScript runs before app code on every navigation, so the stores read
// these values during construction.

/** Seed an OpenRouter key so a provider is "ready" and mark the guide opened. */
export async function seedReadyProvider(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('gatesai.providers.v1', JSON.stringify({ openrouter: { apiKey: 'test-key' } }));
    // Skip the first-install user-guide auto-open (avoids openExternal during tests).
    localStorage.setItem('gatesai.userGuide.opened.v1', '1');
  });
}

export interface SeedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
  retrievalTrace?: RetrievalTrace;
}

export interface SeedThread {
  id: string;
  title: string;
  subtitle: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  modelId: string;
  messages: SeedMessage[];
}

/** Build a minimal valid persisted thread. */
export function makeThread(id: string, title: string, messages: SeedMessage[], pinned = false): SeedThread {
  return {
    id,
    title,
    subtitle: '',
    createdAt: 1,
    updatedAt: 2,
    pinned,
    modelId: 'or-gemini-3-flash',
    messages,
  };
}

export async function seedThreads(page: Page, threads: SeedThread[], activeThreadId: string): Promise<void> {
  await page.addInitScript(
    ({ threads, activeThreadId }) => {
      localStorage.setItem('gatesai.state.v1', JSON.stringify({ threads, activeThreadId }));
    },
    { threads, activeThreadId },
  );
}

export interface SeedImageJob {
  id: string;
  threadId: string;
  prompt: string;
  count: number;
  width: number;
  height: number;
  backend: 'openrouter-image' | 'local-comfy';
  status: 'done';
  results: string[];
  createdAt: number;
  completedAt: number;
}

export function makeCompletedImageJob(id: string, prompt: string, results: string[]): SeedImageJob {
  return {
    id,
    threadId: 't-img',
    prompt,
    count: results.length,
    width: 512,
    height: 512,
    backend: 'openrouter-image',
    status: 'done',
    results,
    createdAt: 1,
    completedAt: 2,
  };
}

export async function seedImageJobs(page: Page, history: SeedImageJob[]): Promise<void> {
  await page.addInitScript(
    (history) => {
      localStorage.setItem('gatesai.imagejobs.v1', JSON.stringify({ history }));
    },
    history,
  );
}

// ── network mocks ────────────────────────────────────────────────────────

interface OpenRouterMockOptions {
  /** Assistant reply text streamed back as a single content delta. */
  reply?: string;
  /** Delay the SSE response so streaming UI (stop button, etc.) is observable. */
  delayMs?: number;
}

/** Mock the OpenRouter chat completion stream (SSE) and an empty catalog. */
export async function mockOpenRouter(page: Page, options: OpenRouterMockOptions = {}): Promise<void> {
  const reply = options.reply ?? 'Mock reply from the assistant.';
  await page.route(OPENROUTER_MODELS_URL, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [] }) }),
  );
  await page.route(OPENROUTER_CHAT_URL, async route => {
    if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs));
    const body = [
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: reply } }] })}\n\n`,
      `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
      'data: [DONE]\n\n',
    ].join('');
    return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body });
  });
}

interface OllamaMockOptions {
  reply?: string;
  models?: string[];
}

export async function mockOllama(page: Page, options: OllamaMockOptions = {}): Promise<void> {
  const reply = options.reply ?? 'Mock local reply from Ollama.';
  const models = options.models ?? ['qwen2.5:7b', 'llama3.2:3b'];
  await page.route(`${OLLAMA_BASE_URL}/api/version`, route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ version: '0.12.0-test' }) }),
  );
  await page.route(`${OLLAMA_BASE_URL}/api/tags`, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        models: models.map(name => ({
          name,
          model: name,
          modified_at: '2026-07-05T00:00:00Z',
          size: 4_000_000_000,
          digest: `sha256:${name}`,
        })),
      }),
    }),
  );
  await page.route(`${OLLAMA_BASE_URL}/api/chat`, route => {
    const body = [
      JSON.stringify({ message: { role: 'assistant', content: reply }, done: false }),
      JSON.stringify({ done: true, done_reason: 'stop', prompt_eval_count: 128, eval_count: 42 }),
    ].join('\n') + '\n';
    return route.fulfill({ status: 200, headers: { 'content-type': 'application/x-ndjson' }, body });
  });
}

/**
 * Fake an online gatesai-bridge: a healthy `/health` response plus a WebSocket
 * server that answers the request/response envelope protocol used by
 * `BridgeClient`. Generic enough that workspace seeding, attachment writes, and
 * image-artifact reads all succeed.
 */
interface BridgeMockFile {
  path: string;
  name: string;
  kind: 'file' | 'dir';
  content?: string;
  mime?: string;
  size?: number;
}

interface BridgeMockOptions {
  files?: BridgeMockFile[];
}

export async function mockBridgeOnline(page: Page, options: BridgeMockOptions = {}): Promise<void> {
  await page.route(BRIDGE_HEALTH_URL, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        status: 'ok',
        version: 'test-bridge-1.0.0',
        workspace_root: 'C:/gatesai-workspace',
        platform: 'win32',
        allowlist: ['python', 'git', 'node', 'sqlite3'],
      }),
    }),
  );

  await page.routeWebSocket(BRIDGE_WS_URL, (ws: WebSocketRoute) => {
    // We act as the server; do NOT connect to a real upstream.
    ws.onMessage((message) => {
      const text = typeof message === 'string' ? message : message.toString();
      let env: { id?: string; type?: string; op?: string; data?: Record<string, unknown> };
      try {
        env = JSON.parse(text);
      } catch {
        return;
      }
      if (env && env.type === 'hello') {
        // Answer the protocol handshake (the app sends hello v2 on connect;
        // silence downgrades the mock to legacy v0 and disables bridge UI).
        ws.send(JSON.stringify({ type: 'hello', protocolVersion: 2 }));
        return;
      }
      if (!env || env.type !== 'request' || !env.id) return;
      const data = handleBridgeOp(env.op, env.data ?? {}, options);
      ws.send(JSON.stringify({ id: env.id, type: 'result', op: env.op, data }));
    });
  });
}

function handleBridgeOp(op: string | undefined, data: Record<string, unknown>, options: BridgeMockOptions): unknown {
  const path = typeof data.path === 'string' ? data.path : '';
  switch (op) {
    case 'fs.write':
      return { path, bytes: typeof data.content === 'string' ? data.content.length : 0 };
    case 'fs.read': {
      const file = options.files?.find(entry => entry.path === path && entry.kind === 'file');
      if (file?.content !== undefined) {
        return {
          path,
          content: file.content,
          encoding: 'utf8',
          size: file.content.length,
          mime: file.mime ?? 'text/plain',
        };
      }
      const base64 = data.encoding === 'base64';
      return {
        path,
        content: base64 ? VISIBLE_IMAGE_SVG_BASE64 : '',
        encoding: base64 ? 'base64' : 'utf8',
        size: base64 ? 345 : 0,
        mime: base64 ? 'image/svg+xml' : 'text/plain',
      };
    }
    case 'fs.stat':
      return { path, kind: 'file', size: 1, mtime: Date.now(), mime: 'text/plain' };
    case 'fs.list':
      return {
        path,
        entries: (options.files ?? [])
          .filter(entry => path === '/workspace'
            ? entry.path.startsWith('/workspace/')
            : entry.path.startsWith(`${path}/`))
          .map(entry => ({
            path: entry.path,
            name: entry.name,
            kind: entry.kind,
            size: entry.size ?? entry.content?.length ?? 1,
            mtime: Date.now(),
            mime: entry.mime ?? (entry.kind === 'file' ? 'text/plain' : undefined),
          })),
      };
    case 'exec.run':
      return { exit_code: 0, duration_ms: 1, stdout: '', stderr: '' };
    default:
      // fs.mkdir / fs.delete / fs.move / fs.copy and anything else: empty ok.
      return {};
  }
}
