import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from './args';
import { fetchOpenRouterCatalog } from './catalog';
import { runLiveCompatibility } from './liveRunner';
import { auditCompatibilityCatalog } from './policy';
import { renderCompatibilityMarkdown } from './report';

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const catalog = await fetchOpenRouterCatalog();
  const audit = auditCompatibilityCatalog(catalog);
  const selected = options.family
    ? audit.families.find(family => family.id === options.family)?.models
    : audit.selected;
  if (!selected) {
    throw new Error(`Unknown family ${JSON.stringify(options.family)}. Choices: ${audit.families.map(family => family.id).join(', ')}`);
  }

  const live = options.mode === 'live'
    ? await runLiveCompatibility({
      apiKey: process.env.OPENROUTER_API_KEY ?? '',
      targets: selected,
      maxCostUsd: options.maxCostUsd,
      onProgress: message => process.stdout.write(`${message}\n`),
    })
    : undefined;
  const payload = { audit, ...(live ? { live } : {}) };
  const markdown = renderCompatibilityMarkdown(audit, live);
  await writeReports(options.outputDir, payload, markdown);

  process.stdout.write(`${markdown}\nReports: ${path.resolve(options.outputDir)}\n`);
  const failed = !audit.passed || (live != null && (live.failed > 0 || live.stoppedForBudget));
  if (failed) process.exitCode = 1;
}

async function writeReports(outputDir: string, payload: unknown, markdown: string): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const json = `${JSON.stringify(payload, null, 2)}\n`;
  await Promise.all([
    writeFile(path.join(outputDir, `model-compat-${stamp}.json`), json, 'utf8'),
    writeFile(path.join(outputDir, `model-compat-${stamp}.md`), markdown, 'utf8'),
    writeFile(path.join(outputDir, 'latest.json'), json, 'utf8'),
    writeFile(path.join(outputDir, 'latest.md'), markdown, 'utf8'),
  ]);
}

main().catch(error => {
  process.stderr.write(`model-compat: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
