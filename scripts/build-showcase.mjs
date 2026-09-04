#!/usr/bin/env node
// Builds the hosted showcase: the desktop-runtime app with the dev scenario
// layer kept in (vite mode `showcase`, served under /app/), plus a catalog
// page at the site root that links every scenario and the thread each
// journey opens. Output goes to dist-showcase/, which firebase.json serves.
//
// The regular `npm run build` still strips the scenario layer and proves it
// with scripts/check-dev-bundle.mjs; only this script sets the mode that
// keeps it.
import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const outDir = path.join(root, 'dist-showcase');
const appDir = path.join(outDir, 'app');

execSync('npx vite build --mode showcase --outDir dist-showcase/app --emptyOutDir', {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_BASE: '/app/' },
});

const catalog = readFileSync(path.join(root, 'src/dev/scenarios/catalog.ts'), 'utf8');
const manifest = JSON.parse(readFileSync(path.join(root, 'journeys/manifest.json'), 'utf8')).journeys;
const scenarioPattern = /\n {2}\{\n {4}name: '([a-z0-9-]+)',\n {4}title: '((?:[^'\\]|\\.)*)',\n {4}description: '((?:[^'\\]|\\.)*)'/g;
const unescape = value => value.replace(/\\'/g, "'");
const scenarios = [];
for (const match of catalog.matchAll(scenarioPattern)) {
  scenarios.push({ name: match[1], title: unescape(match[2]), description: unescape(match[3]), entries: new Map() });
}
const byName = new Map(scenarios.map(scenario => [scenario.name, scenario]));
for (const journey of manifest) {
  const contextPath = journey.context?.path
    ?? journey.steps.find(step => step.action === 'navigate')?.path
    ?? '';
  const scenarioName = /scenario=([a-z0-9-]+)/.exec(contextPath)?.[1];
  const scenario = scenarioName ? byName.get(scenarioName) : undefined;
  if (!scenario) continue;
  if (!scenario.entries.has(contextPath)) scenario.entries.set(contextPath, []);
  scenario.entries.get(contextPath).push(journey.title);
}

const escapeHtml = value => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const appHref = devPath => `/app${devPath}`;
const threadLabel = devPath => {
  const hash = devPath.split('#')[1] ?? '/workspace';
  if (hash.startsWith('/thread/')) return `thread ${hash.slice('/thread/'.length)}`;
  return hash.replace(/^\//, '') || 'workspace';
};

const sections = scenarios.map(scenario => {
  const entries = [...scenario.entries.entries()];
  const primary = entries[0]?.[0] ?? `/?scenario=${scenario.name}#/workspace`;
  const rows = entries.map(([devPath, journeys]) => `
        <li>
          <a href="${escapeHtml(appHref(devPath))}">${escapeHtml(threadLabel(devPath))}</a>
          <span class="journeys">${escapeHtml(journeys.join(' · '))}</span>
        </li>`).join('');
  return `
    <section class="scenario" id="${escapeHtml(scenario.name)}">
      <div class="scenario__head">
        <h2><a href="${escapeHtml(appHref(primary))}">${escapeHtml(scenario.title)}</a></h2>
        <code>?scenario=${escapeHtml(scenario.name)}</code>
      </div>
      <p>${escapeHtml(scenario.description)}</p>
      <ul class="entries">${rows}
      </ul>
    </section>`;
}).join('\n');

const journeyCount = manifest.length;
const generatedAt = new Date().toISOString().slice(0, 10);
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>GatesAI Chat showcase</title>
<link rel="icon" href="/app/favicon.ico">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
<style>
  :root { --bg: #121212; --text: #e4e7ef; --muted: rgba(228,231,239,0.62); --accent: #3ecf8e; --border: rgba(255,255,255,0.09); }
  html, body { margin: 0; background: var(--bg); color: var(--text); font-family: 'Geist', system-ui, sans-serif; }
  main { max-width: 860px; margin: 0 auto; padding: 56px 24px 96px; }
  header h1 { font-family: 'Source Serif 4', Georgia, serif; font-weight: 600; font-size: 40px; margin: 0 0 12px; letter-spacing: -0.01em; }
  header p { margin: 0 0 8px; max-width: 62ch; color: var(--muted); line-height: 1.55; }
  header .facts { margin-top: 20px; display: flex; gap: 28px; flex-wrap: wrap; font-size: 13px; color: var(--muted); }
  header .facts b { color: var(--text); font-weight: 500; }
  .scenario { border-top: 1px solid var(--border); padding: 28px 0 24px; }
  .scenario__head { display: flex; align-items: baseline; gap: 16px; flex-wrap: wrap; }
  .scenario h2 { font-family: 'Source Serif 4', Georgia, serif; font-weight: 600; font-size: 22px; margin: 0; }
  .scenario h2 a { color: var(--text); text-decoration: none; }
  .scenario h2 a:hover { color: var(--accent); }
  .scenario code { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12px; color: var(--muted); }
  .scenario p { margin: 8px 0 14px; color: var(--muted); line-height: 1.55; max-width: 70ch; }
  .entries { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .entries li { display: grid; grid-template-columns: 160px 1fr; gap: 14px; font-size: 14px; line-height: 1.45; }
  .entries a { color: var(--accent); text-decoration: none; font-family: 'Geist Mono', ui-monospace, monospace; font-size: 13px; }
  .entries a:hover { text-decoration: underline; }
  .journeys { color: var(--muted); }
  footer { border-top: 1px solid var(--border); margin-top: 32px; padding-top: 20px; font-size: 13px; color: var(--muted); line-height: 1.5; }
  @media (max-width: 560px) { .entries li { grid-template-columns: 1fr; gap: 2px; } main { padding-top: 36px; } }
</style>
</head>
<body>
<main>
  <header>
    <h1>GatesAI Chat showcase</h1>
    <p>The desktop app running in the browser with every network seam answered by a local mock: OpenRouter, Ollama, the workspace bridge, search and image generation. No key, no bridge process. Each scenario below seeds a different state; each link opens the app on the thread a journey starts from.</p>
    <p>Everything is fake but the app: the transcripts, models and files are the fixtures the journey suite runs against.</p>
    <div class="facts">
      <span><b>${scenarios.length}</b> scenarios</span>
      <span><b>${journeyCount}</b> journeys</span>
      <span>built <b>${generatedAt}</b></span>
      <span><a href="/app/" style="color: var(--accent); text-decoration: none;">open the app bare</a></span>
    </div>
  </header>
${sections}
  <footer>
    Persistence lives in this browser's storage. Switching scenarios reseeds it, so a scenario link always opens the state it describes. The desktop build and the public Web Lite demo do not ship the scenario layer.
  </footer>
</main>
</body>
</html>
`;

mkdirSync(outDir, { recursive: true });
writeFileSync(path.join(outDir, 'index.html'), html);
console.log(`showcase: ${scenarios.length} scenarios, ${journeyCount} journeys, app at ${path.relative(root, appDir)}/`);
