import { describe, expect, it } from 'vitest';
import { inspectFileTool } from '../../src/services/tools/inspectFile';
import { toolRegistry } from '../../src/services/tools/registry';
import type { ToolContext } from '../../src/services/tools/types';

interface FakeRequest { op: string; data: unknown }

function makeCtx(content: string, mime = 'text/plain', requests: FakeRequest[] = [], encoding: 'utf8' | 'base64' = 'utf8'): ToolContext {
  return {
    threadId: 't-test',
    bridge: {
      isOnline: true,
      client: {
        request: async (op: string, data: unknown) => {
          requests.push({ op, data });
          if (op !== 'fs.read') throw new Error(`unexpected op ${op}`);
          return {
            path: '/workspace/attachments/sample',
            content,
            encoding,
            size: content.length,
            mime,
          };
        },
      },
    },
  } as unknown as ToolContext;
}

function makeWorkspaceCtx(respond: (op: string, data: unknown) => unknown, requests: FakeRequest[] = []): ToolContext {
  return {
    threadId: 't-test',
    bridge: {
      isOnline: true,
      client: {
        request: async (op: string, data: unknown) => {
          requests.push({ op, data });
          return respond(op, data);
        },
      },
    },
  } as unknown as ToolContext;
}

function base64(bytes: number[]): string {
  return Buffer.from(bytes).toString('base64');
}

function utf16leBase64(text: string): string {
  const bytes = [0xff, 0xfe];
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    bytes.push(code & 0xff, code >> 8);
  }
  return base64(bytes);
}

describe('inspect_file tool', () => {
  it('profiles CSV files without returning the entire file', async () => {
    const csv = [
      'name,team,score',
      'Ada,core,10',
      'Grace,platform,8',
      'Linus,core,9',
    ].join('\n');

    const out = await inspectFileTool.execute({ action: 'profile', path: 'attachments/scores.csv' }, makeCtx(csv, 'text/csv'));

    expect(out).toContain('format: csv');
    expect(out).toContain('rows: 3');
    expect(out).toContain('columns: name, team, score');
    expect(out).toContain('score: numeric');
    expect(out).not.toContain('Ada,core,10\nGrace,platform,8\nLinus,core,9');
  });

  it('decodes base64 Latin-1 style CSV content before profiling', async () => {
    const csvBytes = [
      ...Array.from(Buffer.from('name,amount\nCaf')),
      0xe9,
      ...Array.from(Buffer.from(',12\n')),
    ];

    const out = await inspectFileTool.execute(
      { action: 'profile', path: 'attachments/latin.csv' },
      makeCtx(base64(csvBytes), 'text/csv', [], 'base64'),
    );

    expect(out).toContain('format: csv');
    expect(out).toContain('detected_encoding: windows-1252');
    expect(out).toContain('rows: 1');
    expect(out).toContain('columns: name, amount');
  });

  it('decodes UTF-16LE CSV content with BOM and strips BOM headers', async () => {
    const out = await inspectFileTool.execute(
      { action: 'profile', path: 'attachments/excel.csv' },
      makeCtx(utf16leBase64('date\tvalue\n2026-01-01\t10\n'), 'text/csv', [], 'base64'),
    );

    expect(out).toContain('detected_encoding: utf-16le');
    expect(out).toContain('detected_delimiter: tab');
    expect(out).toContain('columns: date, value');
    expect(out).toContain('likely_date_columns: date');
  });

  it('profiles quoted commas, numeric ranges, date-like columns, and ragged rows', async () => {
    const csv = [
      '\ufeffdate,name,amount',
      '2026-01-01,"Ada, Inc",10.5',
      '2026-01-02,Grace,12',
      '2026-01-03,MissingAmount',
      '2026-01-04,Extra,14,ignored',
    ].join('\n');

    const out = await inspectFileTool.execute(
      { action: 'profile', path: 'attachments/finance.csv' },
      makeCtx(csv, 'text/csv'),
    );

    expect(out).toContain('detected_delimiter: comma');
    expect(out).toContain('likely_date_columns: date');
    expect(out).toContain('ragged_rows: 2');
    expect(out).toContain('- amount: numeric');
    expect(out).toContain('min 10.5');
    expect(out).toContain('max 14');
  });

  it('extracts selected CSV columns with a row limit', async () => {
    const csv = [
      'name,team,score',
      'Ada,core,10',
      'Grace,platform,8',
      'Linus,core,9',
    ].join('\n');

    const out = await inspectFileTool.execute(
      { action: 'extract', path: 'attachments/scores.csv', columns: ['name', 'score'], limit: 2 },
      makeCtx(csv, 'text/csv'),
    );

    expect(out).toContain('name,score');
    expect(out).toContain('Ada,10');
    expect(out).toContain('Grace,8');
    expect(out).not.toContain('Linus,9');
    expect(out).not.toContain('platform');
  });

  it('profiles JSON shape and array lengths compactly', async () => {
    const json = JSON.stringify({
      users: [
        { id: 1, name: 'Ada', active: true },
        { id: 2, name: 'Grace', active: false },
      ],
      meta: { exportedAt: '2026-04-25' },
    });

    const out = await inspectFileTool.execute({ action: 'profile', path: 'attachments/users.json' }, makeCtx(json, 'application/json'));

    expect(out).toContain('format: json');
    expect(out).toContain('root: object');
    expect(out).toContain('$.users: array(2)');
    expect(out).toContain('$.users[]: object keys id, name, active');
    expect(out).toContain('$.meta: object keys exportedAt');
  });

  it('extracts text line ranges without dumping the whole file', async () => {
    const text = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'].join('\n');

    const out = await inspectFileTool.execute(
      { action: 'extract', path: 'attachments/log.txt', start_line: 2, end_line: 4 },
      makeCtx(text),
    );

    expect(out).toContain('2: beta');
    expect(out).toContain('4: delta');
    expect(out).not.toContain('1: alpha');
    expect(out).not.toContain('5: epsilon');
  });

  it('truncates long text lines with an explicit marker', async () => {
    const longLine = 'x'.repeat(800);

    const out = await inspectFileTool.execute(
      { action: 'extract', path: 'attachments/log.txt', start_line: 1, end_line: 1 },
      makeCtx(longLine),
    );

    expect(out).toContain('[truncated');
    expect(out).not.toContain('x'.repeat(700));
  });

  it('truncates long JSON scalar values in previews', async () => {
    const json = JSON.stringify({ body: 'y'.repeat(1000) });

    const out = await inspectFileTool.execute({ action: 'preview', path: 'attachments/large.json' }, makeCtx(json, 'application/json'));

    expect(out).toContain('[truncated');
    expect(out).not.toContain('y'.repeat(700));
  });

  it('validates CSV aggregate columns', async () => {
    const csv = [
      'name,team,score',
      'Ada,core,10',
      'Grace,platform,8',
    ].join('\n');

    await expect(
      inspectFileTool.execute({ action: 'aggregate', path: 'attachments/scores.csv', op: 'sum', column: 'missing' }, makeCtx(csv, 'text/csv')),
    ).resolves.toContain('unknown CSV column');

    await expect(
      inspectFileTool.execute({ action: 'aggregate', path: 'attachments/scores.csv', op: 'count', group_by: 'missing' }, makeCtx(csv, 'text/csv')),
    ).resolves.toContain('unknown CSV column');
  });

  it('bounds CSV aggregate groups', async () => {
    const csv = ['id,score', ...Array.from({ length: 120 }, (_, i) => `${i},${i}`)].join('\n');

    const out = await inspectFileTool.execute(
      { action: 'aggregate', path: 'attachments/scores.csv', op: 'count', group_by: 'id', limit: 10 },
      makeCtx(csv, 'text/csv'),
    );

    expect(out).toContain('groups: 120');
    expect(out).toContain('truncated: true');
    expect(out).not.toContain('119: 1');
  });

  it('returns an artifact-first workspace profile using bridge list and search ops', async () => {
    const requests: FakeRequest[] = [];
    const ctx = makeWorkspaceCtx((op, data) => {
      if (op === 'fs.list') {
        const path = (data as { path: string }).path;
        if (path === '/workspace/artifacts') {
          return { path, entries: [{ path: '/workspace/artifacts/financial_summary.json', name: 'financial_summary.json', kind: 'file', size: 2048, mtime: 1 }] };
        }
        if (path === '/workspace/attachments') {
          return { path, entries: [{ path: '/workspace/attachments/raw_export.csv', name: 'raw_export.csv', kind: 'file', size: 100000, mtime: 2 }] };
        }
        if (path === '/workspace/notes') {
          return { path, entries: [{ path: '/workspace/notes/query_scripts', name: 'query_scripts', kind: 'dir', mtime: 3 }] };
        }
      }
      if (op === 'fs.search') return { query: 'budget', hits: [{ path: '/workspace/artifacts/financial_summary.json', line: 3, snippet: '"budget": true' }] };
      throw new Error(`unexpected op ${op}`);
    }, requests);

    const out = await inspectFileTool.execute({ action: 'workspace_profile', query: 'budget' }, ctx);

    expect(out).toContain('Workspace profile');
    expect(out).toContain('Artifacts first');
    expect(out).toMatch(/artifacts:[\s\S]*financial_summary\.json/);
    expect(out).toMatch(/attachments:[\s\S]*raw_export\.csv/);
    expect(out).toMatch(/search hints:[\s\S]*financial_summary\.json:3/);
    expect(requests.map(r => r.op)).toEqual(['fs.list', 'fs.list', 'fs.list', 'fs.search']);
  });

  it('is selected for data-file turns', () => {
    const names = toolRegistry.toolDefsForTurn({
      userText: 'what are the columns in this csv attachment?',
      bridgeOnline: true,
    }).map(t => t.name);

    expect(names).toContain('inspect_file');
  });
});
