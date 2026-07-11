import { spawn } from 'node:child_process';
import { access, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { SCREEN_AUDIT_MANIFEST } from './screens-audit-manifest.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightCli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const auditConfig = path.join(root, 'scripts', 'screens-audit.playwright.config.mjs');
const auditSpec = 'screens-local-first-audit.spec.mjs';
const auditDir = path.join(root, 'docs', 'audits', 'screens-2026-07');
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

child.on('error', error => {
  console.error(`Unable to start the screen audit: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`screens:tour terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
