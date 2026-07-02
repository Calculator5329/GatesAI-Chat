import { createHash } from 'node:crypto';
import { mkdir, rm, stat, readdir, readFile, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const outRoot = path.join(repoRoot, 'src-tauri', 'resources', 'source');

export const includeRoots = [
  'assets',
  'docs',
  'public',
  'scripts',
  'src',
  'src-tauri',
  'tests',
  '.gitignore',
  'README.md',
  'eslint.config.js',
  'firebase.json',
  'index.html',
  'package-lock.json',
  'package.json',
  'tsconfig.app.json',
  'tsconfig.json',
  'tsconfig.node.json',
  'tsconfig.test.json',
  'vite.config.ts',
  'vitest.config.ts',
  'vitest.live.config.ts',
];

const excludedSegments = new Set([
  '.git',
  '.claude',
  '.cursor',
  '.firebase',
  'node_modules',
  'dist',
  'dist-ssr',
  'release',
  'target',
  'gen',
  'resources',
]);

const excludedNames = new Set([
  'debug.log',
]);

export function shouldSkip(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  const base = path.basename(relativePath);
  if (base.startsWith('.env')) return true;
  if (base.endsWith('.local')) return true;
  if (excludedNames.has(base)) return true;
  return normalized.split('/').some(part => excludedSegments.has(part));
}

async function listFiles(sourcePath, rootRelative = '') {
  const stats = await stat(sourcePath);
  if (shouldSkip(rootRelative)) return [];
  if (stats.isFile()) return [rootRelative];
  if (!stats.isDirectory()) return [];

  const entries = await readdir(sourcePath, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const childRelative = path.join(rootRelative, entry.name);
    if (shouldSkip(childRelative)) continue;
    const childPath = path.join(sourcePath, entry.name);
    if (entry.isDirectory()) {
      results.push(...await listFiles(childPath, childRelative));
    } else if (entry.isFile()) {
      results.push(childRelative);
    }
  }
  return results;
}

export async function createSourceSnapshot(options = {}) {
  const rootDir = options.repoRoot ?? repoRoot;
  const targetRoot = options.outRoot ?? outRoot;
  const snapshotRoot = path.join(targetRoot, 'current');
  const manifestPath = path.join(targetRoot, 'manifest.json');
  const packageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));

  await rm(snapshotRoot, { recursive: true, force: true });
  await mkdir(snapshotRoot, { recursive: true });

  const files = [];
  for (const root of includeRoots) {
    const absolute = path.join(rootDir, root);
    try {
      const rootFiles = await listFiles(absolute, root);
      files.push(...rootFiles);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  files.sort((a, b) => a.localeCompare(b));

  const hash = createHash('sha256');
  let copiedBytes = 0;
  for (const relative of files) {
    const source = path.join(rootDir, relative);
    const target = path.join(snapshotRoot, relative);
    const bytes = await readFile(source);
    hash.update(relative.split(path.sep).join('/'));
    hash.update('\0');
    hash.update(bytes);
    copiedBytes += bytes.length;
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(source, target);
  }

  const manifest = {
    schemaVersion: 1,
    productName: 'GatesAI Chat',
    packageName: packageJson.name,
    version: packageJson.version,
    createdAt: new Date().toISOString(),
    contentHash: `sha256:${hash.digest('hex')}`,
    fileCount: files.length,
    totalBytes: copiedBytes,
    sourceRootName: 'current',
    excludes: [
      '.env*',
      '.git/',
      '.claude/',
      '.cursor/',
      '.firebase/',
      'node_modules/',
      'dist/',
      'release/',
      'src-tauri/target/',
      'src-tauri/resources/',
    ],
  };

  await mkdir(targetRoot, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  return manifest;
}

if (path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url)) {
  const manifest = await createSourceSnapshot();
  console.log(`Created source snapshot: ${manifest.fileCount} files, ${manifest.totalBytes} bytes, ${manifest.contentHash}`);
}
