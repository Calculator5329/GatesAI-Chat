import type { CompatibilityCatalogAudit } from './policy';
import { estimateCompatibilityCost, type LiveCompatibilityRun } from './liveRunner';

export function renderCompatibilityMarkdown(
  audit: CompatibilityCatalogAudit,
  live?: LiveCompatibilityRun,
): string {
  const lines = [
    '# GatesAI model compatibility',
    '',
    `Catalog audit: **${audit.passed ? 'PASS' : 'FAIL'}**`,
    `Audited: ${audit.auditedAt}`,
    `Selected routes: ${audit.selected.length}`,
    `Estimated full live run: $${estimateCompatibilityCost(audit.selected).toFixed(4)} (320 input + 160 output tokens per request)`,
    '',
    '## Policy coverage',
    '',
    '| Family | Policy | Routes |',
    '| --- | --- | ---: |',
    ...audit.families.map(family => `| ${family.label} | ${family.selection} | ${family.models.length} |`),
    '',
  ];
  if (audit.errors.length) lines.push('## Errors', '', ...audit.errors.map(error => `- ${error}`), '');
  lines.push('## Scope notes', '', ...audit.notices.map(notice => `- ${notice}`), '');
  lines.push('## Selected routes', '', ...audit.families.flatMap(family => [
    `### ${family.label}`,
    '',
    ...family.models.map(model => `- \`${model.id}\`${model.supported_parameters?.includes('tools') ? ' — tools' : ' — text only'}`),
    '',
  ]));

  if (live) {
    lines.push(
      '## Live run',
      '',
      `Result: **${live.failed === 0 && !live.stoppedForBudget ? 'PASS' : 'FAIL'}**`,
      `Finished: ${live.finishedAt}`,
      `Passed: ${live.passed}`,
      `Failed: ${live.failed}`,
      `Estimated cost: $${live.estimatedCostUsd.toFixed(4)}`,
      `Provider-reported cost: $${live.actualCostUsd.toFixed(4)}`,
      `Budget cap: $${live.maxCostUsd.toFixed(2)}`,
      `Stopped for budget: ${live.stoppedForBudget ? 'yes' : 'no'}`,
      '',
      '| Model | Result | Tools | Duration | Cost |',
      '| --- | --- | --- | ---: | ---: |',
      ...live.results.map(result => (
        `| \`${result.modelId}\` | ${result.ok ? 'PASS' : 'FAIL'} | ${result.supportsTools ? 'yes' : 'no'} | ${result.durationMs}ms | $${result.costUsd.toFixed(4)} |`
      )),
      '',
    );
  }
  return `${lines.join('\n')}\n`;
}
