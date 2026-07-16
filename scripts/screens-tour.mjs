import { spawn } from 'node:child_process';
import { access, mkdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SCREEN_AUDIT_MANIFEST } from './screens-audit-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightCli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const auditConfig = path.join(root, 'scripts', 'screens-audit.playwright.config.mjs');
const auditSpec = 'screens-local-first-audit.spec.mjs';
const auditDir = path.join(root, 'docs', 'audits', 'screens-2026-07');
const { version: appVersion } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const themeArg = process.argv.find(arg => arg === '--light' || arg.startsWith('--theme='));
const forcedTheme = themeArg === '--light' ? 'light' : themeArg?.slice('--theme='.length);

if (process.argv.includes('--list')) {
  for (const screen of SCREEN_AUDIT_MANIFEST) {
    console.log(`${screen.file}\t${screen.surface}`);
  }
  process.exit(0);
}

if (forcedTheme && !['dark', 'light', 'system'].includes(forcedTheme)) {
  console.error(`Unsupported theme "${forcedTheme}". Use dark, light, or system.`);
  process.exit(2);
}

await access(playwrightCli).catch(() => {
  console.error('Playwright is not installed. Run npm install before npm run screens:tour.');
  process.exit(2);
});
await mkdir(auditDir, { recursive: true });

const child = spawn(process.execPath, [playwrightCli, 'test', auditSpec, '--config', auditConfig], {
  stdio: 'inherit',
  shell: false,
  cwd: root,
  env: {
    ...process.env,
    SCREENS_AUDIT_DIR: auditDir,
    ...(forcedTheme ? { SCREENS_TOUR_THEME: forcedTheme } : {}),
  },
});

let childError;
const childResult = new Promise(resolve => {
  child.once('error', error => {
    childError = new Error(`Unable to start the screen audit: ${error.message}`);
    resolve({ code: null, signal: null, error: childError });
  });
  child.once('exit', (code, signal) => resolve({ code, signal, error: null }));
});

try {
  // The audit spec captures the desktop Local screen. Exercise the same route
  // against the Web Lite server while the tour is running so a Tauri-only
  // service call, page error, or console error cannot hide behind a screenshot.
  await assertWebLiteLocalMenu(child);
} catch (error) {
  if (child.exitCode === null) child.kill('SIGTERM');
  await childResult;
  console.error(`Web Lite Local menu assertion failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

const { code, signal, error: screenAuditError } = await childResult;
if (screenAuditError) {
  console.error(screenAuditError.message);
  process.exit(1);
}
if (signal) {
  console.error(`screens:tour terminated by ${signal}`);
  process.exit(1);
}
process.exit(code ?? 1);

async function assertWebLiteLocalMenu(auditProcess) {
  const port = e2ePort('GATESAI_E2E_WEB_LITE_PORT', 5274);
  const baseUrl = `http://127.0.0.1:${port}`;
  await waitForApp(baseUrl, auditProcess);

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`console: ${message.text()}`);
    });
    await page.addInitScript(version => {
      localStorage.setItem('gatesai.userGuide.opened.v1', '1');
      localStorage.setItem('gatesai.whatsNew.v1', JSON.stringify({
        lastSeenVersion: version,
        tourThreadSeeded: true,
      }));
    }, appVersion);
    await page.goto(`${baseUrl}/#/menu/local`);
    await page.getByRole('heading', { name: 'Local', exact: true }).waitFor();
    await page.getByRole('note').filter({ hasText: 'managed runtime controls are desktop-only' }).waitFor();

    if (await page.getByText('Runtimes', { exact: true }).count()) {
      throw new Error('desktop managed-runtime controls were rendered');
    }
    await page.waitForTimeout(250);
    if (errors.length) throw new Error(errors.join('; '));
  } finally {
    await browser.close();
  }
}

async function waitForApp(baseUrl, auditProcess) {
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (childError) throw childError;
    if (auditProcess.exitCode !== null) {
      throw new Error(`screen audit exited before Web Lite started (code ${auditProcess.exitCode})`);
    }
    try {
      const response = await fetch(baseUrl);
      if (response.ok && /<title>GatesAI Chat<\/title>/.test(await response.text())) return;
    } catch {
      // The audit's global setup is still starting Vite.
    }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Web Lite server did not become ready at ${baseUrl}`);
}

function e2ePort(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65_536 ? parsed : fallback;
}
