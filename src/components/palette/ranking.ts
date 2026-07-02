// Pure ranking helpers for the command palette.
// Called by CommandPalette and unit tests; keeps search behavior dependency-free.
export interface PaletteRankable {
  label: string;
  subtitle?: string;
  keywords?: string[];
}

export interface RankedPaletteItem<T extends PaletteRankable> {
  item: T;
  score: number;
}

export function rankPaletteItems<T extends PaletteRankable>(items: readonly T[], query: string): RankedPaletteItem<T>[] {
  const needle = normalize(query);
  return items
    .map((item, index) => {
      const score = scorePaletteItem(item, needle);
      return score == null ? null : { item, score: score - index / 1000 };
    })
    .filter((entry): entry is RankedPaletteItem<T> => entry !== null)
    .sort((a, b) => b.score - a.score);
}

export function scorePaletteItem(item: PaletteRankable, normalizedQuery: string): number | null {
  if (!normalizedQuery) return 1;
  const fields: Array<[string | undefined, number]> = [
    [item.label, 80],
    [item.subtitle, 28],
    [item.keywords?.join(' '), 42],
  ];
  let best: number | null = null;
  for (const [field, weight] of fields) {
    if (!field) continue;
    const score = scoreField(normalize(field), normalizedQuery, weight);
    if (score == null) continue;
    best = Math.max(best ?? score, score);
  }
  return best;
}

function scoreField(haystack: string, needle: string, weight: number): number | null {
  const substringIndex = haystack.indexOf(needle);
  if (substringIndex >= 0) {
    return 1000 + weight + needle.length * 8 - substringIndex * 3;
  }

  const subsequence = scoreSubsequence(haystack, needle);
  if (subsequence == null) return null;
  return 520 + weight + subsequence;
}

function scoreSubsequence(haystack: string, needle: string): number | null {
  let hayIndex = 0;
  let first = -1;
  let last = -1;
  let adjacent = 0;
  for (let needleIndex = 0; needleIndex < needle.length; needleIndex += 1) {
    const char = needle[needleIndex];
    const found = haystack.indexOf(char, hayIndex);
    if (found < 0) return null;
    if (first < 0) first = found;
    if (found === last + 1) adjacent += 1;
    last = found;
    hayIndex = found + 1;
  }
  const spread = last - first + 1;
  return needle.length * 12 + adjacent * 8 - spread;
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}
