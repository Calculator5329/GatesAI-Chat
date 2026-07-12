import { execFile, spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { promisify } from 'node:util';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightCli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const config = path.join(root, 'scripts', 'screenshots.playwright.config.mjs');
const spec = 'screenshots.spec.mjs';

await access(playwrightCli).catch(() => {
  console.error('Playwright is not installed. Run npm install before npm run screenshots.');
  process.exit(2);
});

const runFile = promisify(execFile);
let gitSha;
try {
  gitSha = (await runFile('git', ['rev-parse', '--short=8', 'HEAD'], { cwd: root })).stdout.trim();
} catch (error) {
  // Managed sandboxes can report EPERM after a read-only subprocess completed.
  // Keep its valid stdout; ordinary command failures still surface normally.
  const stdout = typeof error === 'object' && error && 'stdout' in error ? String(error.stdout).trim() : '';
  if (!/^[0-9a-f]+$/i.test(stdout)) throw error;
  gitSha = stdout;
}
const outputDir = path.join(root, 'screenshots', gitSha);

const child = spawn(process.execPath, [playwrightCli, 'test', spec, '--config', config], {
  cwd: root,
  env: {
    ...process.env,
    SCREENSHOTS_GIT_SHA: gitSha,
    SCREENSHOTS_OUTPUT_DIR: outputDir,
    SCREENSHOTS_TIMESTAMP: new Date().toISOString(),
  },
  shell: false,
  stdio: 'inherit',
});

child.on('error', error => {
  console.error(`Unable to start the screenshot pipeline: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`Screenshot pipeline terminated by ${signal}.`);
    process.exit(1);
  }
  if (code === 0) console.log(`Screenshots written to ${path.relative(root, outputDir)}`);
  process.exit(code ?? 1);
});
