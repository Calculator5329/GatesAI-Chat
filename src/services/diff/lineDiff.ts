export type LineDiffRow =
  | { type: 'context'; text: string; oldLine: number; newLine: number }
  | { type: 'removed'; text: string; oldLine: number }
  | { type: 'added'; text: string; newLine: number };

export function diffLines(before: string, after: string): LineDiffRow[] {
  const left = splitLines(before);
  const right = splitLines(after);
  const table = lcsTable(left, right);
  const rows: LineDiffRow[] = [];
  let i = 0;
  let j = 0;

  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      rows.push({ type: 'context', text: left[i], oldLine: i + 1, newLine: j + 1 });
      i += 1;
      j += 1;
    } else if (j < right.length && (i === left.length || table[i][j + 1] >= table[i + 1][j])) {
      rows.push({ type: 'added', text: right[j], newLine: j + 1 });
      j += 1;
    } else if (i < left.length) {
      rows.push({ type: 'removed', text: left[i], oldLine: i + 1 });
      i += 1;
    }
  }

  return rows;
}

function splitLines(value: string): string[] {
  if (!value) return [];
  const normalized = value.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function lcsTable(left: string[], right: string[]): number[][] {
  const table = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0) as number[]);
  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      table[i][j] = left[i] === right[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}
