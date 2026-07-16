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
const SETTINGS_SURFACES = [
  { route: 'settings', label: 'Settings', marker: 'Settings' },
  { route: 'usage', label: 'Usage', marker: 'LLM usage - cloud spend and local tokens' },
  { route: 'agent', label: 'Agent', marker: 'Instructions' },
  { route: 'models', label: 'Models', marker: 'Cloud model access' },
  { route: 'local', label: 'Local', marker: 'Custom endpoint (OpenAI-compatible)' },
  { route: 'workspace', label: 'Workspace', marker: 'Workspace root' },
  { route: 'gallery', label: 'Gallery', marker: 'Gallery' },
];
const SETTINGS_VIEWPORTS = [
  { width: 1280, height: 800 },
  { width: 820, height: 800 },
];

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
  // The screenshot spec owns the visual corpus. While both Vite modes are up,
  // walk every menu/settings route and enforce runtime, routing, error, and
  // horizontal-layout contracts that a screenshot alone cannot prove.
  await assertSettingsSurfaces(child);
} catch (error) {
  if (child.exitCode === null) child.kill('SIGTERM');
  await childResult;
  console.error(`Settings walkthrough assertion failed: ${error instanceof Error ? error.message : String(error)}`);
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

async function assertSettingsSurfaces(auditProcess) {
  const runtimes = [
    { name: 'desktop', baseUrl: `http://127.0.0.1:${e2ePort('GATESAI_E2E_DESKTOP_PORT', 5273)}` },
    { name: 'web-lite', baseUrl: `http://127.0.0.1:${e2ePort('GATESAI_E2E_WEB_LITE_PORT', 5274)}` },
  ];
  await Promise.all(runtimes.map(runtime => waitForApp(runtime.baseUrl, auditProcess)));

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    for (const runtime of runtimes) {
      const page = await browser.newPage({ viewport: SETTINGS_VIEWPORTS[0] });
      let checkpoint = `${runtime.name} boot`;
      const errors = [];
      page.on('pageerror', error => errors.push(`${checkpoint} pageerror: ${error.message}`));
      page.on('console', message => {
        if (message.type() === 'error') errors.push(`${checkpoint} console: ${message.text()}`);
      });
      await installSettingsMocks(page);
      await page.addInitScript(version => {
        localStorage.setItem('gatesai.userGuide.opened.v1', '1');
        localStorage.setItem('gatesai.menuHintSeen.v1', '1');
        localStorage.setItem('gatesai.whatsNew.v1', JSON.stringify({
          lastSeenVersion: version,
          tourThreadSeeded: true,
        }));
      }, appVersion);

      try {
        for (const viewport of SETTINGS_VIEWPORTS) {
          await page.setViewportSize(viewport);
          for (const surface of SETTINGS_SURFACES) {
            checkpoint = `${runtime.name} ${surface.route} ${viewport.width}x${viewport.height}`;
            await openSettingsSurface(page, runtime, surface);
            await assertSettingsLayout(page, checkpoint);
          }
        }
        checkpoint = `${runtime.name} internal routes`;
        await assertInternalSettingsRoutes(page, runtime.baseUrl);
        if (errors.length) throw new Error(errors.join('; '));
      } finally {
        await page.close();
      }
    }
  } finally {
    await browser.close();
  }
}

async function installSettingsMocks(page) {
  await page.route('http://127.0.0.1:7331/health', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      status: 'ok',
      version: 'settings-walkthrough',
      workspace_root: '/workspace',
      platform: 'linux',
      allowlist: ['git', 'node', 'python'],
    }),
  }));
  await page.routeWebSocket('ws://127.0.0.1:7331/ws', socket => {
    socket.onMessage(message => {
      let envelope;
      try {
        envelope = JSON.parse(typeof message === 'string' ? message : message.toString());
      } catch {
        return;
      }
      if (envelope?.type === 'hello') {
        socket.send(JSON.stringify({ type: 'hello', protocolVersion: 2 }));
        return;
      }
      if (envelope?.type === 'request' && envelope.id) {
        const data = envelope.op === 'fs.list'
          ? { path: envelope.data?.path ?? '/workspace', entries: [], truncated: false }
          : {};
        socket.send(JSON.stringify({ id: envelope.id, type: 'result', op: envelope.op, data }));
      }
    });
  });
}

async function openSettingsSurface(page, runtime, surface) {
  await page.goto(`${runtime.baseUrl}/#/menu/${surface.route}`);
  const body = page.locator('.gates-menu__body');
  await body.waitFor();
  const tab = page.locator('.gates-menu__tabs').getByRole('button', { name: surface.label, exact: true });
  await tab.waitFor();
  if (await tab.getAttribute('data-active') !== 'true') {
    throw new Error(`${runtime.name} ${surface.route}: routed tab is not active`);
  }
  const expectedHash = `#/menu/${surface.route}`;
  if (new URL(page.url()).hash !== expectedHash) {
    throw new Error(`${runtime.name} ${surface.route}: expected ${expectedHash}, got ${new URL(page.url()).hash}`);
  }

  const marker = surface.route === 'workspace' && runtime.name === 'web-lite'
    ? 'Desktop-only workspace capabilities'
    : surface.marker;
  await body.getByText(marker, { exact: false }).first().waitFor();

  if (runtime.name === 'web-lite') {
    await assertWebLiteDegradation(page, surface.route);
  } else if (surface.route === 'settings') {
    await page.locator('.settings-desktop').waitFor();
    if (await page.locator('.settings-browser-data').count()) {
      throw new Error('desktop settings rendered the Web Lite browser-data block');
    }
  }
  await page.waitForTimeout(75);
}

async function assertWebLiteDegradation(page, route) {
  if (route === 'settings') {
    await page.getByText('Your data is saved in this browser', { exact: true }).waitFor();
    if (await page.locator('.settings-desktop').count()) {
      throw new Error('Web Lite settings rendered desktop-only controls');
    }
    return;
  }
  const expectedNotices = {
    local: 'managed runtime controls are desktop-only',
    workspace: "local /workspace bridge isn't available",
    gallery: 'artifact gallery are desktop-only',
  };
  const notice = expectedNotices[route];
  if (!notice) return;
  await page.getByRole('note').filter({ hasText: notice }).waitFor();
  if (route === 'local' && await page.getByText('Runtimes', { exact: true }).count()) {
    throw new Error('Web Lite Local rendered managed-runtime controls');
  }
}

async function assertInternalSettingsRoutes(page, baseUrl) {
  const transitions = [
    { from: 'settings', selector: '.settings-apikey-card', button: 'Manage key', to: 'models' },
    { from: 'settings', selector: '.settings-help-line', button: 'Models', to: 'models' },
    { from: 'settings', selector: '.settings-help-line', button: 'Local', to: 'local' },
    { from: 'models', selector: '.gates-menu__body', button: 'Open Local', to: 'local' },
  ];
  for (const transition of transitions) {
    await page.goto(`${baseUrl}/#/menu/${transition.from}`);
    const control = page.locator(transition.selector).getByRole('button', { name: transition.button, exact: true });
    await control.waitFor();
    await control.click();
    await page.waitForFunction(expected => window.location.hash === expected, `#/menu/${transition.to}`);
    const active = page.locator('.gates-menu__tabs').getByRole('button', {
      name: SETTINGS_SURFACES.find(surface => surface.route === transition.to).label,
      exact: true,
    });
    if (await active.getAttribute('data-active') !== 'true') {
      throw new Error(`${transition.from} -> ${transition.to}: destination tab is not active`);
    }
  }
}

async function assertSettingsLayout(page, checkpoint) {
  const result = await page.locator('.gates-menu__body').evaluate(body => {
    const bodyRect = body.getBoundingClientRect();
    const tolerance = 2;
    const clippedControls = [];
    const controls = body.querySelectorAll('button, input, select, textarea, a[href]');
    for (const control of controls) {
      const style = getComputedStyle(control);
      const rect = control.getBoundingClientRect();
      if (style.display === 'none' || style.visibility === 'hidden' || rect.width === 0 || rect.height === 0) continue;
      let ancestor = control.parentElement;
      let insideHorizontalScroller = false;
      while (ancestor && ancestor !== body) {
        const overflowX = getComputedStyle(ancestor).overflowX;
        if ((overflowX === 'auto' || overflowX === 'scroll') && ancestor.scrollWidth > ancestor.clientWidth + tolerance) {
          insideHorizontalScroller = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (insideHorizontalScroller) continue;
      if (rect.left < bodyRect.left - tolerance || rect.right > bodyRect.right + tolerance) {
        clippedControls.push(`${control.tagName.toLowerCase()} "${control.getAttribute('aria-label') ?? control.textContent?.trim().slice(0, 40) ?? ''}" [${Math.round(rect.left)}, ${Math.round(rect.right)}]`);
      }
    }
    return {
      bodyClientWidth: body.clientWidth,
      bodyScrollWidth: body.scrollWidth,
      clippedControls,
    };
  });
  if (result.bodyScrollWidth > result.bodyClientWidth + 2) {
    throw new Error(`${checkpoint}: menu body overflows horizontally (${result.bodyScrollWidth}px > ${result.bodyClientWidth}px)`);
  }
  if (result.clippedControls.length) {
    throw new Error(`${checkpoint}: clipped controls: ${result.clippedControls.join(', ')}`);
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
