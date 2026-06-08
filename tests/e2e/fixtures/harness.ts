// Shared Playwright helpers: localStorage seeding + network/bridge mocking.
// These let browser specs run the real app deterministically without a live
// OpenRouter account or a running gatesai-bridge sidecar.
import type { Page, WebSocketRoute } from '@playwright/test';

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
const BRIDGE_HEALTH_URL = 'http://127.0.0.1:7331/health';
const BRIDGE_WS_URL = 'ws://127.0.0.1:7331/ws';

// A valid 1x1 transparent PNG so image tiles that read bytes via the bridge
// render a real <img> instead of the loading placeholder.
const ONE_PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

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

/**
 * Fake an online gatesai-bridge: a healthy `/health` response plus a WebSocket
 * server that answers the request/response envelope protocol used by
 * `BridgeClient`. Generic enough that workspace seeding, attachment writes, and
 * image-artifact reads all succeed.
 */
export async function mockBridgeOnline(page: Page): Promise<void> {
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
      if (!env || env.type !== 'request' || !env.id) return;
      const data = handleBridgeOp(env.op, env.data ?? {});
      ws.send(JSON.stringify({ id: env.id, type: 'result', op: env.op, data }));
    });
  });
}

function handleBridgeOp(op: string | undefined, data: Record<string, unknown>): unknown {
  const path = typeof data.path === 'string' ? data.path : '';
  switch (op) {
    case 'fs.write':
      return { path, bytes: typeof data.content === 'string' ? data.content.length : 0 };
    case 'fs.read': {
      const base64 = data.encoding === 'base64';
      return {
        path,
        content: base64 ? ONE_PX_PNG_BASE64 : '',
        encoding: base64 ? 'base64' : 'utf8',
        size: base64 ? 70 : 0,
        mime: base64 ? 'image/png' : 'text/plain',
      };
    }
    case 'fs.stat':
      return { path, kind: 'file', size: 1, mtime: Date.now(), mime: 'text/plain' };
    case 'fs.list':
      return { path, entries: [] };
    case 'exec.run':
      return { exit_code: 0, duration_ms: 1, stdout: '', stderr: '' };
    default:
      // fs.mkdir / fs.delete / fs.move / fs.copy and anything else: empty ok.
      return {};
  }
}
