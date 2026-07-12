import type { FullConfig } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DESKTOP_PORT, WEB_LITE_PORT } from './ports';

const SERVER_TIMEOUT_MS = 120_000;
// Marker proving the server on our port is actually this app. Without this
// check, any unrelated dev server squatting the port gets "reused" and every
// spec fails with cryptic element-not-found errors against the wrong app.
const APP_MARKER = /<title>GatesAI Chat<\/title>/;
const ROOT = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const VITE_BIN = path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js');

interface StartedServer {
  label: string;
  process: ChildProcess;
}

export default async function globalSetup(_config: FullConfig) {
  const started: StartedServer[] = [];
  const isCI = Boolean(process.env.CI);

  await ensureServer({
    label: 'desktop',
    port: DESKTOP_PORT,
    args: [VITE_BIN, '--host', '127.0.0.1', '--port', String(DESKTOP_PORT), '--strictPort'],
    reuseExisting: !isCI,
    started,
  });
  await ensureServer({
    label: 'web-lite',
    port: WEB_LITE_PORT,
    args: [VITE_BIN, '--host', '127.0.0.1', '--mode', 'web-lite', '--port', String(WEB_LITE_PORT), '--strictPort'],
    reuseExisting: !isCI,
    started,
  });

  return async () => {
    for (const server of started.reverse()) await stopServer(server);
  };
}

async function ensureServer(args: {
  label: string;
  port: number;
  args: string[];
  reuseExisting: boolean;
  started: StartedServer[];
}): Promise<void> {
  const url = `http://127.0.0.1:${args.port}`;
  const occupant = await probe(url);
  if (occupant === 'ours' && args.reuseExisting) return;
  if (occupant !== 'free') {
    throw new Error(
      `Port ${args.port} is serving something that is not GatesAI Chat `
      + `(or reuse is disabled). Stop that server, or rerun with `
      + `GATESAI_E2E_DESKTOP_PORT / GATESAI_E2E_WEB_LITE_PORT set to free ports.`,
    );
  }

  const child = spawn(process.execPath, args.args, {
    cwd: ROOT,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  args.started.push({ label: args.label, process: child });
  child.stdout?.on('data', chunk => process.stdout.write(`[vite:${args.label}] ${chunk}`));
  child.stderr?.on('data', chunk => process.stderr.write(`[vite:${args.label}] ${chunk}`));
  await waitForServer(url, child, args.label);
}

async function waitForServer(url: string, child: ChildProcess, label: string): Promise<void> {
  const deadline = Date.now() + SERVER_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`${label} dev server exited early with code ${child.exitCode}.`);
    }
    if (await probe(url) === 'ours') return;
    await delay(250);
  }
  throw new Error(`${label} dev server did not become ready at ${url}.`);
}

/** What is answering on this URL: nothing, this app, or a foreign server. */
async function probe(url: string): Promise<'free' | 'ours' | 'foreign'> {
  try {
    const response = await fetch(url);
    if (response.status >= 500) return 'foreign';
    const body = await response.text();
    return APP_MARKER.test(body) ? 'ours' : 'foreign';
  } catch {
    return 'free';
  }
}

async function stopServer(server: StartedServer): Promise<void> {
  const pid = server.process.pid;
  if (!pid || server.process.exitCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>(resolve => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
        stdio: 'ignore',
        windowsHide: true,
      });
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
    });
    return;
  }

  server.process.kill('SIGTERM');
  await Promise.race([
    new Promise<void>(resolve => server.process.once('exit', () => resolve())),
    delay(5_000).then(() => {
      if (server.process.exitCode === null) server.process.kill('SIGKILL');
    }),
  ]);
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
