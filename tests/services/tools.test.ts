import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotesStore } from '../../src/stores/NotesStore';
import { notesTool } from '../../src/services/tools/notes';
import { timeTool } from '../../src/services/tools/time';
import { threadTool } from '../../src/services/tools/thread';
import { fsTool } from '../../src/services/tools/fs';
import { terminalTool } from '../../src/services/tools/terminal';
import { pythonInlineTool } from '../../src/services/tools/pythonInline';
import { sqliteQueryTool } from '../../src/services/tools/sqliteQuery';
import { queryScriptTool } from '../../src/services/tools/queryScript';
import { gitTool } from '../../src/services/tools/git';
import { workspaceTool } from '../../src/services/tools/workspace';
import { toolRegistry } from '../../src/services/tools/registry';
import type { ToolContext } from '../../src/services/tools/types';
import type { Thread } from '../../src/core/types';
import { DEFAULT_MODEL_ID } from '../../src/core/models';
import { clearAppStorage } from '../helpers/storage';

const NOTES_KEY = 'gatesai.notes.v1';

/**
 * Minimal tool context for unit tests. Each tool only touches a subset of
 * fields, so we cast to satisfy TS without standing up the full graph.
 */
function makeCtx(overrides: Partial<ToolContext>): ToolContext {
  return {
    profile: undefined,
    chat: undefined,
    notes: undefined,
    summary: undefined,
    threadId: 't-test',
    ...overrides,
  } as unknown as ToolContext;
}

beforeEach(() => { clearAppStorage(); localStorage.removeItem(NOTES_KEY); });
afterEach(() => { clearAppStorage(); localStorage.removeItem(NOTES_KEY); });

describe('time tool', () => {
  it('returns ISO + local + timezone with no arguments', async () => {
    const out = await timeTool.execute({}, makeCtx({}));
    expect(out).toMatch(/^iso: \d{4}-\d{2}-\d{2}T/m);
    expect(out).toMatch(/^local: /m);
    expect(out).toMatch(/^timezone: /m);
    expect(out).toMatch(/^unix_ms: \d+/m);
  });
});

describe('notes tool', () => {
  it('errors on unknown action', async () => {
    const notes = new NotesStore();
    const out = await notesTool.execute({ action: 'destroy' }, makeCtx({ notes }));
    expect(out).toMatch(/unknown action/);
  });

  it('creates, reads, updates, searches, lists, and deletes a note end to end', async () => {
    const notes = new NotesStore();
    const ctx = makeCtx({ notes });

    // create
    const created = await notesTool.execute(
      { action: 'create', title: 'Project Apollo', body: 'Goal: land on the moon.', tags: ['nasa', 'space'] },
      ctx,
    );
    expect(created).toMatch(/^Created note n-/);
    const id = created.match(/Created note (n-[a-z0-9]+)/)![1];

    // read
    const read = await notesTool.execute({ action: 'read', id }, ctx);
    expect(read).toContain('title: Project Apollo');
    expect(read).toContain('Tags: nasa, space');
    expect(read).toContain('Goal: land on the moon.');

    // update body + tags
    const updated = await notesTool.execute(
      { action: 'update', id, body: 'Goal: land humans on the moon and return them safely.', tags: ['nasa'] },
      ctx,
    );
    expect(updated).toMatch(/^Updated note /);
    expect(notes.findById(id)!.body).toContain('return them safely');
    expect(notes.findById(id)!.tags).toEqual(['nasa']);

    // search hit
    const hit = await notesTool.execute({ action: 'search', query: 'moon' }, ctx);
    expect(hit).toContain(id);
    expect(hit).toContain('Project Apollo');

    // search miss
    const miss = await notesTool.execute({ action: 'search', query: 'mars' }, ctx);
    expect(miss).toMatch(/No notes matched/);

    // list
    const listed = await notesTool.execute({ action: 'list' }, ctx);
    expect(listed).toContain(id);

    // delete
    const deleted = await notesTool.execute({ action: 'delete', id }, ctx);
    expect(deleted).toMatch(/^Deleted note /);
    expect(notes.findById(id)).toBeNull();
  });

  it('rejects create without title or body', async () => {
    const notes = new NotesStore();
    const ctx = makeCtx({ notes });
    expect(await notesTool.execute({ action: 'create', body: 'x' }, ctx)).toMatch(/`title` is required/);
    expect(await notesTool.execute({ action: 'create', title: 'x' }, ctx)).toMatch(/`body` is required/);
  });

  it('rejects update with no patch fields', async () => {
    const notes = new NotesStore();
    const note = notes.create({ title: 't', body: 'b' });
    const ctx = makeCtx({ notes });
    const out = await notesTool.execute({ action: 'update', id: note.id }, ctx);
    expect(out).toMatch(/at least one of/);
  });

  it('returns a friendly message when notes store is missing', async () => {
    const out = await notesTool.execute({ action: 'list' }, makeCtx({}));
    expect(out).toMatch(/notes store unavailable/);
  });
});

describe('thread tool', () => {
  function fakeChatStore(threads: Thread[]) {
    return {
      threads,
      activeThreadId: threads[0]?.id ?? null,
      renameThread(id: string, title: string) {
        const t = threads.find(x => x.id === id);
        if (t) t.title = title.trim() || 'Untitled conversation';
      },
      setThreadContext(id: string, ctx: string) {
        const t = threads.find(x => x.id === id);
        if (t) t.threadContext = ctx;
      },
      selectThread(id: string) {
        if (threads.some(x => x.id === id)) (this as { activeThreadId: string }).activeThreadId = id;
      },
    };
  }

  function thread(id: string, overrides: Partial<Thread> = {}): Thread {
    return {
      id,
      title: `Thread ${id}`,
      subtitle: '',
      modelId: DEFAULT_MODEL_ID,
      messages: [],
      createdAt: 0,
      updatedAt: Date.now(),
      pinned: false,
      ...overrides,
    };
  }

  it('rename: updates title on current thread by default', async () => {
    const threads = [thread('t1'), thread('t2')];
    const chat = fakeChatStore(threads);
    const out = await threadTool.execute(
      { action: 'rename', title: 'New title' },
      makeCtx({ chat: chat as unknown as ToolContext['chat'], threadId: 't1' }),
    );
    expect(out).toContain('Renamed t1');
    expect(threads[0].title).toBe('New title');
  });

  it('set_context: persists the context string', async () => {
    const threads = [thread('t1')];
    const chat = fakeChatStore(threads);
    const out = await threadTool.execute(
      { action: 'set_context', context: 'Working on Q4 planning.' },
      makeCtx({ chat: chat as unknown as ToolContext['chat'], threadId: 't1' }),
    );
    expect(out).toContain('Set context for t1');
    expect(threads[0].threadContext).toBe('Working on Q4 planning.');
  });

  it('get_context: returns the stored context, or a placeholder when empty', async () => {
    const threads = [thread('t1', { threadContext: 'Hello world' })];
    const chat = fakeChatStore(threads);
    const ctx = makeCtx({ chat: chat as unknown as ToolContext['chat'], threadId: 't1' });

    expect(await threadTool.execute({ action: 'get_context' }, ctx)).toBe('Hello world');

    threads[0].threadContext = '';
    expect(await threadTool.execute({ action: 'get_context' }, ctx)).toMatch(/no context set/);
  });

  it('switch_to: requires id and updates active thread', async () => {
    const threads = [thread('t1'), thread('t2')];
    const chat = fakeChatStore(threads);
    const ctx = makeCtx({ chat: chat as unknown as ToolContext['chat'], threadId: 't1' });

    expect(await threadTool.execute({ action: 'switch_to' }, ctx)).toMatch(/`id` is required/);

    const out = await threadTool.execute({ action: 'switch_to', id: 't2' }, ctx);
    expect(out).toContain('Switched active thread to t2');
    expect(chat.activeThreadId).toBe('t2');
  });

  it('list: returns recently-updated threads', async () => {
    const threads = [
      thread('t1', { updatedAt: 1000, title: 'Old' }),
      thread('t2', { updatedAt: 5000, title: 'Newer', summary: 'a recap' }),
    ];
    const chat = fakeChatStore(threads);
    const out = await threadTool.execute(
      { action: 'list' },
      makeCtx({ chat: chat as unknown as ToolContext['chat'], threadId: 't1' }),
    );
    const lines = out.split('\n');
    expect(lines[0]).toContain('t2');
    expect(lines[0]).toContain('a recap');
    expect(lines[1]).toContain('t1');
  });

  it('errors clearly when summary store is missing', async () => {
    const threads = [thread('t1')];
    const chat = fakeChatStore(threads);
    const out = await threadTool.execute(
      { action: 'summarize_now' },
      makeCtx({ chat: chat as unknown as ToolContext['chat'], threadId: 't1' }),
    );
    expect(out).toMatch(/summary store unavailable/);
  });
});

interface FakeRequest { op: string; data: unknown }
function fakeBridge(opts: { online: boolean; respond?: (op: string, data: unknown) => unknown; requests?: FakeRequest[] }): ToolContext['bridge'] {
  return {
    isOnline: opts.online,
    client: {
      request: async (op: string, data: unknown) => {
        opts.requests?.push({ op, data });
        return opts.respond ? opts.respond(op, data) : {};
      },
    },
  } as unknown as ToolContext['bridge'];
}

describe('fs tool', () => {
  it('returns a friendly error when the bridge is offline', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: false }) });
    const out = await fsTool.execute({ action: 'read', path: 'notes/x.md' }, ctx);
    expect(out).toMatch(/bridge offline/i);
  });

  it('rejects unknown actions', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }) });
    const out = await fsTool.execute({ action: 'frobnicate' }, ctx);
    expect(out).toMatch(/unknown action/i);
  });

  it('requires a non-empty action', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }) });

    await expect(fsTool.execute({}, ctx)).resolves.toMatch(/`action` is required for fs/i);
    await expect(fsTool.execute({ action: '' }, ctx)).resolves.toMatch(/`action` is required for fs/i);
    await expect(fsTool.execute({ action: 12 }, ctx)).resolves.toMatch(/`action` is required for fs/i);
  });

  it('formats a read response with header + body', async () => {
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        respond: (op) => {
          if (op !== 'fs.read') throw new Error(`unexpected op ${op}`);
          return { path: '/workspace/notes/x.md', content: 'hello', encoding: 'utf8', size: 5, mime: 'text/markdown' };
        },
      }),
    });
    const out = await fsTool.execute({ action: 'read', path: 'notes/x.md' }, ctx);
    expect(out).toContain('path: /workspace/notes/x.md');
    expect(out).toContain('mime: text/markdown');
    expect(out).toContain('size: 5  encoding: utf8');
    expect(out.endsWith('hello')).toBe(true);
  });

  it('caps large read output with a model-facing continuation hint', async () => {
    const content = 'x'.repeat(220);
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        respond: () => ({ path: '/workspace/notes/big.txt', content, encoding: 'utf8', size: content.length, mime: 'text/plain' }),
      }),
    });

    const out = await fsTool.execute({ action: 'read', path: 'notes/big.txt', max_chars: 40 }, ctx);

    expect(out).toContain('truncated: true');
    expect(out).toContain('showing first 40 chars');
    expect(out).not.toContain('x'.repeat(100));
  });

  it('write requires content', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }) });
    const out = await fsTool.execute({ action: 'write', path: 'notes/x.md' }, ctx);
    expect(out).toMatch(/`content` is required/);
  });

  it('list formats entries with kind + size + path', async () => {
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        respond: () => ({
          path: '/workspace',
          entries: [
            { path: '/workspace/notes', name: 'notes', kind: 'dir', mtime: 0 },
            { path: '/workspace/x.md', name: 'x.md', kind: 'file', size: 12, mtime: 0 },
          ],
        }),
      }),
    });
    const out = await fsTool.execute({ action: 'list' }, ctx);
    expect(out).toContain('d        -  /workspace/notes');
    expect(out).toContain('-      12b  /workspace/x.md');
  });

  it('treats legacy bridge null list entries as empty', async () => {
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        respond: () => ({ path: '/workspace/notes/empty', entries: null }),
      }),
    });

    const out = await fsTool.execute({ action: 'list', path: '/workspace/notes/empty' }, ctx);

    expect(out).toBe('/workspace/notes/empty is empty.');
  });

  it('treats legacy bridge null search hits as no matches', async () => {
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        respond: () => ({ query: 'gamma', hits: null }),
      }),
    });

    const out = await fsTool.execute({ action: 'search', path: '/workspace/notes', query: 'gamma' }, ctx);

    expect(out).toBe('No matches for "gamma" under /workspace/notes.');
  });
});

describe('terminal tool', () => {
  it('returns a friendly error when the bridge is offline', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: false }) });
    const out = await terminalTool.execute({ cmd: 'ls' }, ctx);
    expect(out).toMatch(/bridge offline/i);
  });

  it('requires a cmd', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }) });
    const out = await terminalTool.execute({}, ctx);
    expect(out).toMatch(/`cmd` is required/);
  });

  it('formats stdout / stderr / exit code in the result', async () => {
    const requests: FakeRequest[] = [];
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        requests,
        respond: () => ({
          exit_code: 0, duration_ms: 12, stdout: 'one\ntwo\n', stderr: 'warn\n',
        }),
      }),
    });
    const out = await terminalTool.execute({ cmd: 'ls', args: ['-a'] }, ctx);
    expect(out).toContain('$ ls -a');
    expect(out).toContain('[exit 0, 12ms]');
    expect(out).toContain('--- stdout ---');
    expect(out).toContain('one');
    expect(out).toContain('--- stderr ---');
    expect(out).toContain('warn');
    expect(requests[0].op).toBe('exec.run');
  });

  it('compacts large stdout and stderr with head/tail slices', async () => {
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        respond: () => ({
          exit_code: 0,
          duration_ms: 12,
          stdout: Array.from({ length: 80 }, (_, i) => `out-${i}`).join('\n'),
          stderr: Array.from({ length: 80 }, (_, i) => `err-${i}`).join('\n'),
        }),
      }),
    });

    const out = await terminalTool.execute({ cmd: 'node', args: ['script.js'] }, ctx);

    expect(out).toContain('[stdout compacted');
    expect(out).toContain('out-0');
    expect(out).toContain('out-79');
    expect(out).not.toContain('out-40');
    expect(out).toContain('[stderr compacted');
  });
});

describe('python_inline tool', () => {
  it('runs short Python snippets through python argv directly', async () => {
    const requests: FakeRequest[] = [];
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        requests,
        respond: () => ({ exit_code: 0, duration_ms: 9, stdout: '42\n', stderr: '' }),
      }),
    });

    const out = await pythonInlineTool.execute({ code: 'print(6 * 7)', stdin: 'input', timeout_ms: 1000 }, ctx);

    expect(out).toContain('$ python -c <inline>');
    expect(out).toContain('42');
    expect(requests[0]).toEqual({
      op: 'exec.run',
      data: {
        cmd: 'python',
        args: ['-c', 'print(6 * 7)'],
        cwd: undefined,
        stdin: 'input',
        timeout_ms: 1000,
      },
    });
  });

  it('does not route inline Python through broad shells', async () => {
    const requests: FakeRequest[] = [];
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        requests,
        respond: () => ({ exit_code: 0, duration_ms: 1, stdout: '', stderr: '' }),
      }),
    });

    await pythonInlineTool.execute({ code: 'print("safe")' }, ctx);

    expect((requests[0].data as { cmd: string }).cmd).toBe('python');
    expect((requests[0].data as { cmd: string }).cmd).not.toMatch(/powershell|cmd/i);
  });
});

describe('sqlite_query tool', () => {
  it('runs a scoped SQLite query through a Python helper instead of sqlite shell', async () => {
    const requests: FakeRequest[] = [];
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        requests,
        respond: () => ({
          exit_code: 0,
          duration_ms: 14,
          stdout: JSON.stringify({
            columns: ['month', 'net_worth'],
            rows: [['2025-12', 123456]],
            row_count: 1,
            truncated: false,
          }),
          stderr: '',
        }),
      }),
    });

    const out = await sqliteQueryTool.execute({
      path: 'artifacts/finance.db',
      sql: 'select month, net_worth from monthly_net_worth limit 1',
      timeout_ms: 1000,
    }, ctx);

    expect(out).toContain('columns: month, net_worth');
    expect(out).toContain('["2025-12",123456]');
    expect(requests[0].op).toBe('exec.run');
    const data = requests[0].data as { cmd: string; args: string[]; stdin: string };
    expect(data.cmd).toBe('python');
    expect(data.cmd).not.toMatch(/sqlite3|powershell|cmd/i);
    expect(data.args).toEqual(['-c', expect.any(String)]);
    expect(JSON.parse(data.stdin)).toMatchObject({
      path: 'artifacts/finance.db',
      sql: 'select month, net_worth from monthly_net_worth limit 1',
    });
  });

  it('rejects SQLite dot-commands and multiple statements', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }) });

    await expect(sqliteQueryTool.execute({ path: 'x.db', sql: '.shell dir' }, ctx)).resolves.toMatch(/dot-commands/i);
    await expect(sqliteQueryTool.execute({ path: 'x.db', sql: 'select 1; select 2' }, ctx)).resolves.toMatch(/single statement/i);
  });
});

describe('query_script tool', () => {
  it('returns an organized Python CSV query script template', async () => {
    const out = await queryScriptTool.execute({ action: 'template_python_csv_query', topic: 'budget history' }, makeCtx({}));

    expect(out).toContain('/workspace/notes/query_scripts/budget_history.py');
    expect(out).toContain('/workspace/artifacts/budget_history.json');
    expect(out).toContain('Path.cwd()');
    expect(out).toContain('attachments/');
    expect(out).toContain('validate');
  });

  it('returns JSON query and artifact audit templates', async () => {
    await expect(queryScriptTool.execute({ action: 'template_json_query', topic: 'plan migration' }, makeCtx({})))
      .resolves.toContain('/workspace/notes/query_scripts/plan_migration.py');
    await expect(queryScriptTool.execute({ action: 'template_artifact_audit', topic: 'finance' }, makeCtx({})))
      .resolves.toContain('/workspace/artifacts/finance_audit.json');
  });
});

describe('workspace tool', () => {
  it('reports bridge runtime info and path contract', async () => {
    const ctx = makeCtx({
      bridge: {
        isOnline: true,
        version: '0.1.0',
        workspaceRoot: 'C:\\Users\\me\\GatesAI\\workspace',
        platform: 'windows',
        allowlist: ['python', 'node'],
      } as ToolContext['bridge'],
    });

    const out = await workspaceTool.execute({ action: 'info' }, ctx);

    expect(out).toContain('state: online');
    expect(out).toContain('platform: windows');
    expect(out).toContain('allowlist: python, node');
    expect(out).toContain('/workspace/... is model-facing');
  });

  it('explains script execution from cwd', async () => {
    const out = await workspaceTool.execute({ action: 'how_to_run_scripts' }, makeCtx({}));

    expect(out).toContain('Path.cwd()');
    expect(out).toContain('fs.write');
    expect(out).toContain('terminal');
  });
});

describe('tool registry harness selection', () => {
  it('keeps ordinary chat turns on the small always-on tool set', () => {
    const names = toolRegistry.toolDefsForTurn({
      userText: 'tell me a story',
      bridgeOnline: false,
    }).map(t => t.name);

    expect(names).toEqual(['memory', 'thread']);
    expect(names).not.toContain('time');
  });

  it('includes workspace tools for attachment and code turns', () => {
    const names = toolRegistry.toolDefsForTurn({
      userText: 'convert this CSV attachment into JSON',
      bridgeOnline: true,
    }).map(t => t.name);

    expect(names).toEqual(expect.arrayContaining(['workspace', 'fs', 'inspect_file', 'terminal', 'python_inline', 'sqlite_query', 'query_script', 'git']));
  });
});

describe('git tool', () => {
  it('returns a friendly error when the bridge is offline', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: false }) });
    const out = await gitTool.execute({ action: 'status' }, ctx);
    expect(out).toMatch(/bridge offline/i);
  });

  it('runs status through git with short branch output', async () => {
    const requests: FakeRequest[] = [];
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        requests,
        respond: () => ({ exit_code: 0, duration_ms: 5, stdout: '## master\n M src/app.ts\n', stderr: '' }),
      }),
    });

    const out = await gitTool.execute({ action: 'status' }, ctx);

    expect(out).toContain('$ git status --short --branch');
    expect(out).toContain('## master');
    expect(requests[0]).toEqual({
      op: 'exec.run',
      data: { cmd: 'git', args: ['status', '--short', '--branch'], cwd: undefined, timeout_ms: 10000 },
    });
  });

  it('stages explicit paths with git add', async () => {
    const requests: FakeRequest[] = [];
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        requests,
        respond: () => ({ exit_code: 0, duration_ms: 8, stdout: '', stderr: '' }),
      }),
    });

    await gitTool.execute({ action: 'add', paths: ['src/a.ts', 'tests/a.test.ts'] }, ctx);

    expect(requests[0].data).toMatchObject({
      cmd: 'git',
      args: ['add', '--', 'src/a.ts', 'tests/a.test.ts'],
    });
  });

  it('commits with a required message', async () => {
    const requests: FakeRequest[] = [];
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        requests,
        respond: () => ({ exit_code: 0, duration_ms: 12, stdout: '[master abc123] local work\n', stderr: '' }),
      }),
    });

    await expect(gitTool.execute({ action: 'commit' }, ctx)).resolves.toMatch(/`message` is required/i);
    const out = await gitTool.execute({ action: 'commit', message: 'local work' }, ctx);

    expect(out).toContain('$ git commit -m local work');
    expect(requests[0].data).toMatchObject({
      cmd: 'git',
      args: ['commit', '-m', 'local work'],
    });
  });

  it('requires confirmation before restoring local changes', async () => {
    const requests: FakeRequest[] = [];
    const ctx = makeCtx({
      bridge: fakeBridge({
        online: true,
        requests,
        respond: () => ({ exit_code: 0, duration_ms: 4, stdout: '', stderr: '' }),
      }),
    });

    await expect(gitTool.execute({ action: 'restore', paths: ['src/a.ts'] }, ctx)).resolves.toMatch(/requires confirm/i);
    await gitTool.execute({ action: 'restore', paths: ['src/a.ts'], confirm: 'restore local changes' }, ctx);

    expect(requests).toHaveLength(1);
    expect(requests[0].data).toMatchObject({
      cmd: 'git',
      args: ['restore', '--', 'src/a.ts'],
    });
  });

  it('does not expose remote or destructive git actions', async () => {
    const ctx = makeCtx({ bridge: fakeBridge({ online: true }) });

    await expect(gitTool.execute({ action: 'push' }, ctx)).resolves.toMatch(/unknown action/i);
    await expect(gitTool.execute({ action: 'reset' }, ctx)).resolves.toMatch(/unknown action/i);
  });
});
