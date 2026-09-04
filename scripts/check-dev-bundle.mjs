#!/usr/bin/env node
// Fails when the dev-only scenario layer (src/dev/) leaks into a production
// bundle. src/main.tsx imports it behind import.meta.env.DEV; this proves the
// dead branch was actually dropped by scanning every emitted JS chunk for the
// sentinel string and for the scenario query parameter name.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const distDir = path.resolve(process.argv[2] ?? 'dist');
const SENTINEL = 'GATESAI_DEV_SCENARIO_LAYER';
const MARKERS = [SENTINEL, '__gatesaiScenario', 'scenario-bridge-1.0.0'];

async function* walk(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(js|mjs|cjs)$/.test(entry.name)) yield full;
  }
}

let scanned = 0;
const leaks = [];
for await (const file of walk(distDir)) {
  scanned += 1;
  const text = await readFile(file, 'utf8');
  for (const marker of MARKERS) {
    if (text.includes(marker)) leaks.push(`${path.relative(distDir, file)} contains ${marker}`);
  }
}

if (scanned === 0) {
  console.error(`check-dev-bundle: no JS files found under ${distDir}`);
  process.exit(2);
}
if (leaks.length > 0) {
  console.error('check-dev-bundle: dev scenario layer leaked into the production bundle:');
  for (const leak of leaks) console.error(`  ${leak}`);
  process.exit(1);
}
console.log(`check-dev-bundle: ${scanned} chunks scanned, no dev scenario code in ${path.relative(process.cwd(), distDir) || '.'}`);
