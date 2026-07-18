#!/usr/bin/env node
// Wrapper for `tauri build`. On Linux, linuxdeploy's bundled strip cannot
// parse .relr.dyn sections emitted by newer toolchains (e.g. CachyOS),
// which kills AppImage packaging — NO_STRIP=1 skips that strip pass.
import { spawnSync } from 'node:child_process';

const env = { ...process.env };
if (process.platform === 'linux' && env.NO_STRIP === undefined) {
  env.NO_STRIP = '1';
}

// On Windows npx is npx.cmd, which spawnSync cannot exec without a shell —
// without this the build dies silently with a null status.
const result = spawnSync('npx', ['tauri', 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
  shell: process.platform === 'win32',
});
if (result.error) console.error('tauri build failed to spawn:', result.error);
process.exit(result.status ?? 1);
