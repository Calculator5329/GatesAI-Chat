#!/usr/bin/env node
// Wrapper for `tauri build`. On Linux, linuxdeploy's bundled strip cannot
// parse .relr.dyn sections emitted by newer toolchains (e.g. CachyOS),
// which kills AppImage packaging — NO_STRIP=1 skips that strip pass.
import { spawnSync } from 'node:child_process';

const env = { ...process.env };
if (process.platform === 'linux' && env.NO_STRIP === undefined) {
  env.NO_STRIP = '1';
}

const result = spawnSync('npx', ['tauri', 'build', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env,
});
process.exit(result.status ?? 1);
