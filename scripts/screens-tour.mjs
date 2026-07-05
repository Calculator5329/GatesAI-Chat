import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightCli = path.join(root, 'node_modules', '@playwright', 'test', 'cli.js');
const child = spawn(process.execPath, [playwrightCli, 'test', 'tests/e2e/screensTour.spec.ts'], {
  stdio: 'inherit',
  shell: false,
  env: {
    ...process.env,
    SCREENS_TOUR: '1',
  },
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`screens:tour terminated by ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
