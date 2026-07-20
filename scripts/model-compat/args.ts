export interface CliOptions {
  mode: 'catalog' | 'live';
  maxCostUsd: number;
  outputDir: string;
  family?: string;
}

export function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    mode: 'catalog',
    maxCostUsd: 2,
    outputDir: 'artifacts/model-compat',
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === '--mode' && (value === 'catalog' || value === 'live')) {
      options.mode = value;
      index += 1;
    } else if (arg === '--max-cost-usd' && value) {
      options.maxCostUsd = Number(value);
      index += 1;
    } else if (arg === '--output' && value) {
      options.outputDir = value;
      index += 1;
    } else if (arg === '--family' && value) {
      options.family = value;
      index += 1;
    } else if (arg === '--') {
      continue;
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }
  if (!Number.isFinite(options.maxCostUsd) || options.maxCostUsd <= 0) {
    throw new Error('--max-cost-usd must be a positive number.');
  }
  return options;
}
