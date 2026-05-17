import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { UiStore } from '../../../src/stores/UiStore';
import { ExecStreamStore } from '../../../src/stores/ExecStreamStore';
import { ImageJobStore } from '../../../src/stores/ImageJobStore';
import { ChatStore } from '../../../src/stores/ChatStore';
import { ProviderStore } from '../../../src/stores/ProviderStore';
import { ModelRegistry } from '../../../src/stores/ModelRegistry';
import { UserProfileStore } from '../../../src/stores/UserProfileStore';
import { EditorialMessage } from '../../../src/components/editorial/EditorialMessage';
import { __htmlArtifactPreviewTestApi } from '../../../src/components/editorial/HtmlArtifactPreview';
import type { RootStore } from '../../../src/stores/RootStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg role="img"><text>Diagram</text></svg>' })),
  },
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function htmlFromPreviewFrame(frame: HTMLIFrameElement | null | undefined): string {
  const src = frame?.getAttribute('src') ?? '';
  if (!src.startsWith('data:text/html')) return frame?.getAttribute('srcdoc') ?? '';
  const encoded = src.split(',', 2)[1] ?? '';
  return decodeURIComponent(encoded);
}

function createTestStore(imageJobs = new ImageJobStore()): RootStore {
  const registry = new ModelRegistry();
  const providers = new ProviderStore(registry);
  const chat = new ChatStore(providers, registry, new UserProfileStore());
  const execStream = new ExecStreamStore();
  chat.setToolStoresProvider(() => ({
    execStream,
    imageJobs,
  }));
  return {
    chat,
    ui: new UiStore(),
    execStream,
    imageJobs,
    bridge: {
      isOnline: true,
      client: {
        request: vi.fn(async (op: string) => {
          if (op === 'fs.stat') return { path: '/workspace/artifacts/reports/demo.html', kind: 'file', size: 42, mtime: 1 };
          if (op === 'fs.read') return { path: '/workspace/artifacts/reports/demo.html', content: '<h1>Artifact</h1>', encoding: 'utf8', size: 42, mime: 'text/html' };
          throw new Error(`unexpected op ${op}`);
        }),
      },
      openWorkspacePath: vi.fn(async () => true),
    },
  } as unknown as RootStore;
}

function renderMessage(
  message: Parameters<typeof EditorialMessage>[0]['message'],
  modelName = 'Assistant',
  streaming = false,
  preTokenLabel?: Parameters<typeof EditorialMessage>[0]['preTokenLabel'],
  imageJobs = new ImageJobStore(),
  handlers: Pick<
    Parameters<typeof EditorialMessage>[0],
    'onRegenerate' | 'onBranch' | 'onEditAndResend' | 'actionsDisabled'
  > = {},
): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  const store = createTestStore(imageJobs);

  act(() => {
    root!.render(
      createElement(StoreProvider, {
        store,
        children: createElement(EditorialMessage, {
          modelName,
          streaming,
          preTokenLabel,
          message,
          ...handlers,
        }),
      }),
    );
  });
  return host;
}

function renderMessageHarness(
  message: Parameters<typeof EditorialMessage>[0]['message'],
  streaming = false,
): { host: HTMLDivElement; rerender: (nextMessage: typeof message, nextStreaming?: boolean) => void } {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const store = createTestStore();

  const rerender = (nextMessage: typeof message, nextStreaming = streaming) => {
    act(() => {
      root!.render(
        createElement(StoreProvider, {
          store,
          children: createElement(EditorialMessage, {
            modelName: 'Assistant',
            streaming: nextStreaming,
            message: nextMessage,
          }),
        }),
      );
    });
  };

  rerender(message, streaming);
  return { host, rerender };
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  host?.remove();
  host = null;
  __htmlArtifactPreviewTestApi.reset();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('EditorialMessage markdown rendering', () => {
  it('renders dollar amounts as currency text instead of inline math', () => {
    const rendered = renderMessage({
      id: 'm-currency',
      role: 'assistant',
      createdAt: Date.now(),
      content: "So in 2027, you're targeting $120,000 gross/$85,700 take-home, with a strong **57.86% savings rate** and **$39,600 going into investments** — a big jump from 2026's $87,500 gross.",
    });

    expect(rendered.textContent).toContain('$120,000 gross/$85,700 take-home');
    expect(rendered.textContent).toContain('$39,600 going into investments');
    expect(rendered.querySelector('.katex')).toBeNull();
  });

  it('renders user attachment footers as compact attachment chips', () => {
    const rendered = renderMessage({
      id: 'm-user-attachment',
      role: 'user',
      createdAt: Date.now(),
      content: 'Normalize these files.\n\n📎 Attached files (use `inspect_file` for CSV/JSON/text; use fs for byte-level reads/writes):\n  - /workspace/attachments/plan.csv · 10.7KB · text/csv',
    }, 'You');

    const body = rendered.querySelector('.user-message-body');
    const attachments = rendered.querySelector('.user-attachments');

    expect(body?.textContent).toBe('Normalize these files.');
    expect(body?.classList.contains('user-attachment-chip')).toBe(false);
    expect(attachments?.textContent).toContain('CSV');
    expect(attachments?.textContent).toContain('plan.csv');
    expect(attachments?.textContent).toContain('10.7KB');
    expect(attachments?.textContent).not.toContain('Attached files');
    expect(attachments?.textContent).not.toContain('fs');
    expect(attachments?.textContent).not.toContain('/workspace/attachments/plan.csv');
  });

  it('groups overflow non-image attachments after the first four files', () => {
    const rendered = renderMessage({
      id: 'm-many-attachments',
      role: 'user',
      createdAt: Date.now(),
      content: 'Use these files.',
      attachments: Array.from({ length: 6 }, (_, index) => ({
        path: `/workspace/attachments/file-${index + 1}.csv`,
        name: `file-${index + 1}.csv`,
        mime: 'text/csv',
        size: 1024 + index,
      })),
    }, 'You');

    expect(rendered.querySelectorAll('.user-attachment-chip')).toHaveLength(4);
    expect(rendered.querySelector('.user-attachment-more')?.textContent).toContain('+2 files');
    expect(rendered.textContent).toContain('file-1.csv');
    expect(rendered.textContent).not.toContain('file-6.csv');
  });

  it('does not render a block caret after streamed markdown content', () => {
    const rendered = renderMessage({
      id: 'm-streaming-markdown',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'Yes — that is the right next step.',
    }, 'Assistant', true);

    expect(rendered.textContent).toContain('Yes');
    expect(rendered.querySelector('.stream-caret')).toBeNull();
    expect(rendered.querySelector('[aria-label="Thinking"]')).toBeNull();
    expect(rendered.querySelector('[aria-label="Working"]')).toBeNull();
  });

  it('renders active assistant streams as markdown without a duplicate working row', () => {
    const streaming = renderMessage({
      id: 'm-active-stream',
      role: 'assistant',
      createdAt: Date.now(),
      content: '**bold so far**',
    }, 'Assistant', true);

    expect(streaming.querySelector('.streaming-plain-text')).toBeNull();
    expect(streaming.querySelector('strong')?.textContent).toBe('bold so far');
    expect(streaming.textContent).not.toContain('working');
    expect(streaming.querySelector('[aria-label="Working"]')).toBeNull();
    expect(streaming.querySelector('.editorial-message')?.getAttribute('style')).not.toContain('border-bottom');

    act(() => root?.unmount());
    root = null;
    host?.remove();
    host = null;

    const finalized = renderMessage({
      id: 'm-final-stream',
      role: 'assistant',
      createdAt: Date.now(),
      content: '**bold now final**',
    }, 'Assistant', false);

    expect(finalized.querySelector('.streaming-plain-text')).toBeNull();
    expect(finalized.querySelector('strong')?.textContent).toBe('bold now final');
    expect(finalized.querySelector('[aria-label="Working"]')).toBeNull();
  });

  it('smooths visible text updates during streaming', () => {
    vi.useFakeTimers();
    const initial = {
      id: 'm-smooth-stream',
      role: 'assistant' as const,
      createdAt: Date.now(),
      content: 'Hello',
    };
    const { host: rendered, rerender } = renderMessageHarness(initial, true);

    expect(rendered.textContent).toContain('Hello');

    rerender({
      ...initial,
      content: 'Hello, this should ease into view instead of jumping all at once.',
    }, true);

    expect(rendered.textContent).toContain('Hello');
    expect(rendered.textContent).not.toContain('jumping all at once');

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(rendered.textContent).toContain('jumping all at once');
  });

  it('can label an empty streaming assistant message as responding', () => {
    const rendered = renderMessage({
      id: 'm-responding',
      role: 'assistant',
      createdAt: Date.now(),
      content: '',
    }, 'Assistant', true, 'responding');

    expect(rendered.textContent).toContain('Responding');
    expect(rendered.querySelector('[aria-label="Responding"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Thinking"]')).toBeNull();
  });

  it('rewrites markdown anchors to /workspace/ paths into workspace-link buttons', () => {
    const rendered = renderMessage({
      id: 'm-anchor-workspace',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'See [the artifact](/workspace/artifacts/foo.png) for details.',
    });

    expect(rendered.querySelector('.workspace-path-link')).not.toBeNull();
    expect(rendered.querySelector('a[href^="/workspace/"]')).toBeNull();
  });

  it('renders markdown links to HTML workspace artifacts as inline previews', async () => {
    const rendered = renderMessage({
      id: 'm-anchor-html',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'Open [the artifact](/workspace/artifacts/reports/demo.html) for details.',
    });

    await act(async () => {
      await flushMicrotasks();
    });

    expect(rendered.querySelector('.html-artifact-preview')).not.toBeNull();
    expect(rendered.querySelector('.workspace-path-link')).toBeNull();
    expect(htmlFromPreviewFrame(rendered.querySelector('iframe'))).toContain('<h1>Artifact</h1>');
  });

  it('renders inline code HTML workspace artifacts as inline previews', async () => {
    const rendered = renderMessage({
      id: 'm-code-html',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'Saved it at `/workspace/artifacts/reports/demo.htm`.',
    });

    await act(async () => {
      await flushMicrotasks();
    });

    expect(rendered.querySelector('.html-artifact-preview')).not.toBeNull();
    expect(rendered.querySelector('.workspace-path-link')).toBeNull();
  });

  it('renders mermaid fences as diagrams instead of plain code blocks', async () => {
    const rendered = renderMessage({
      id: 'm-mermaid',
      role: 'assistant',
      createdAt: Date.now(),
      content: '```mermaid\ngraph TD\n  A[User] --> B[App]\n```',
    });

    await act(async () => {
      await flushMicrotasks();
    });

    expect(rendered.querySelector('.mermaid-diagram')).not.toBeNull();
    expect(rendered.querySelector('.mermaid-diagram svg')).not.toBeNull();
  });

  it('still renders external markdown anchors as anchor tags', () => {
    const rendered = renderMessage({
      id: 'm-anchor-external',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'See [the docs](https://example.com/foo) for details.',
    });

    const anchor = rendered.querySelector('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toBe('https://example.com/foo');
    expect(anchor?.getAttribute('target')).toBe('_blank');
  });

  it('can label an empty streaming assistant message as compacting', () => {
    const rendered = renderMessage({
      id: 'm-compacting',
      role: 'assistant',
      createdAt: Date.now(),
      content: '',
    }, 'Assistant', true, 'compacting');

    expect(rendered.textContent).toContain('Compacting');
    expect(rendered.querySelector('[aria-label="Compacting"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Thinking"]')).toBeNull();
  });

  it('shows a live web search status while tool results are pending', () => {
    const rendered = renderMessage({
      id: 'm-searching',
      role: 'assistant',
      createdAt: Date.now(),
      content: '',
      toolCalls: [
        { id: 'tc-search', name: 'web_search', arguments: { queries: ['latest models', 'current API docs'] } },
      ],
    }, 'Assistant', true);

    expect(rendered.textContent).toContain('Searching latest models');
    expect(rendered.querySelector('[aria-label="Searching latest models"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Thinking"]')).not.toBeNull();
    expect(rendered.textContent).not.toContain('status: ok');
  });

  it('fans out mixed pending tool batches into separate live statuses', () => {
    const rendered = renderMessage({
      id: 'm-batch-tools',
      role: 'assistant',
      createdAt: Date.now(),
      content: '',
      toolCalls: [
        { id: 'tc-search', name: 'web_search', arguments: { queries: ['model pricing', 'tool UX'] } },
        { id: 'tc-file-a', name: 'inspect_file', arguments: { action: 'search', query: 'LiveStatusIndicator' } },
        { id: 'tc-file-b', name: 'inspect_file', arguments: { action: 'preview', path: '/workspace/src/components/editorial/EditorialMessage.tsx' } },
      ],
    }, 'Assistant', true);

    expect(rendered.textContent).toContain('Searching model pricing');
    expect(rendered.textContent).toContain('Searching LiveStatusIndicator');
    expect(rendered.textContent).toContain('Inspecting EditorialMessage.tsx');
    expect(rendered.querySelector('[aria-label="Thinking"]')).not.toBeNull();
  });

  it('morphs to a completed search summary after tool results land', () => {
    const rendered = renderMessage({
      id: 'm-drafting',
      role: 'assistant',
      createdAt: Date.now(),
      content: '',
      toolCalls: [
        { id: 'tc-search', name: 'web_search', arguments: { queries: ['latest models'] } },
      ],
      toolResults: [
        { toolCallId: 'tc-search', toolName: 'web_search', content: 'status: ok', ranAt: Date.now() },
      ],
    }, 'Assistant', true);

    expect(rendered.textContent).toContain('Search complete');
    expect(rendered.querySelector('[aria-label="Searching latest models"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Thinking"]')).not.toBeNull();
    expect(rendered.textContent).not.toContain('Drafting answer');
    expect(rendered.textContent).not.toContain('status: ok');
  });

  it('uses tool arguments in live workspace statuses', () => {
    const rendered = renderMessage({
      id: 'm-reading-file',
      role: 'assistant',
      createdAt: Date.now(),
      content: '',
      toolCalls: [
        { id: 'tc-file', name: 'inspect_file', arguments: { action: 'preview', path: '/workspace/data/reports/quarterly.csv' } },
      ],
    }, 'Assistant', true);

    expect(rendered.textContent).toContain('Inspecting quarterly.csv');
    expect(rendered.querySelector('[aria-label="Inspecting quarterly.csv"]')).not.toBeNull();
  });

  it('uses action-specific labels for pending workspace writes', () => {
    const rendered = renderMessage({
      id: 'm-creating-dir',
      role: 'assistant',
      createdAt: Date.now(),
      content: '',
      toolCalls: [
        { id: 'tc-mkdir', name: 'fs', arguments: { action: 'mkdir', path: '/workspace/artifacts/pacman-game' } },
      ],
    }, 'Assistant', true);

    expect(rendered.textContent).toContain('Creating pacman-game');
    expect(rendered.textContent).not.toContain('Reading workspace');
  });

  it('uses action-specific labels for pending HTML artifacts', () => {
    const rendered = renderMessage({
      id: 'm-creating-artifact',
      role: 'assistant',
      createdAt: Date.now(),
      content: '',
      toolCalls: [
        { id: 'tc-artifact', name: 'artifact', arguments: { action: 'create_html_artifact', path: '/workspace/artifacts/exports/game.html' } },
      ],
    }, 'Assistant', true);

    expect(rendered.textContent).toContain('Creating game.html');
    expect(rendered.textContent).not.toContain('Using artifact');
  });

  it('shows workspace continuation while waiting for the final response', () => {
    const rendered = renderMessage({
      id: 'm-continuing-workspace',
      role: 'assistant',
      createdAt: Date.now(),
      content: '',
      toolCalls: [
        { id: 'tc-mkdir', name: 'fs', arguments: { action: 'mkdir', path: '/workspace/artifacts/pacman-game' } },
      ],
      toolResults: [
        {
          toolCallId: 'tc-mkdir',
          toolName: 'fs',
          content: 'Created directory /workspace/artifacts/pacman-game',
          ranAt: Date.now(),
        },
      ],
    }, 'Assistant', true);

    expect(rendered.textContent).toContain('Created directory /workspace/artifacts/pacman-game');
    expect(rendered.querySelector('[aria-label="Creating pacman-game"]')).not.toBeNull();
  });

  it('keeps recovery visible after invalid tool arguments land', () => {
    const rendered = renderMessage({
      id: 'm-invalid-tool-recovery',
      role: 'assistant',
      createdAt: Date.now(),
      content: '',
      toolCalls: [
        { id: 'tc-fs', name: 'fs', arguments: {}, argumentsError: 'Tool arguments for fs were not valid JSON.' },
      ],
      toolResults: [
        {
          toolCallId: 'tc-fs',
          toolName: 'fs',
          content: 'fs failed: Tool arguments for fs were not valid JSON.',
          ok: false,
          errorCode: 'invalid_tool_arguments',
          retryable: true,
          ranAt: Date.now(),
        },
      ],
    }, 'Assistant', true);

    expect(rendered.textContent).toContain('fs failed');
    expect(rendered.querySelector('[aria-label="Reading"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Thinking"]')).not.toBeNull();
  });

  it('treats batch validation failures as invalid tool arguments while streaming', () => {
    const rendered = renderMessage({
      id: 'm-invalid-batch-recovery',
      role: 'assistant',
      createdAt: Date.now(),
      content: '',
      toolCalls: [
        { id: 'tc-fs', name: 'fs', arguments: { action: 'read' } },
      ],
      toolResults: [
        {
          toolCallId: 'tc-fs',
          toolName: 'fs',
          content: [
            'status: error',
            'tool: tool_batch_policy',
            'error_code: invalid_tool_batch',
            'summary: Tool batch stopped at call 0 because 1 tool call failed validation.',
            'status: error',
            'tool: fs',
            'error_code: missing_required_argument',
          ].join('\n'),
          ok: false,
          errorCode: 'missing_required_argument',
          retryable: true,
          ranAt: Date.now(),
        },
      ],
    }, 'Assistant', true);

    expect(rendered.textContent).toContain('Tool batch stopped at call 0');
    expect(rendered.textContent).not.toContain('Tool returned an error; asking the model to recover...');
  });

  it('summarizes source count while streaming a tool-backed answer', () => {
    const rendered = renderMessage({
      id: 'm-writing-sources',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'Here is what I found so far.',
      toolCalls: [
        { id: 'tc-search', name: 'web_search', arguments: { queries: ['latest models'] } },
      ],
      toolResults: [
        {
          toolCallId: 'tc-search',
          toolName: 'web_search',
          content: 'status: ok\n[1] One\nurl: https://example.com/one\n[2] Two\nurl: https://example.com/two',
          ranAt: Date.now(),
        },
      ],
    }, 'Assistant', true);

    expect(rendered.textContent).toContain('Found 2 sources');
    expect(rendered.querySelector('[aria-label="Searching latest models"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Drafting"]')).toBeNull();
    expect(rendered.textContent).not.toContain('Writing answer');
    expect(rendered.textContent).not.toContain('https://example.com/one');
  });

  it('keeps the search summary after streaming is complete', () => {
    const rendered = renderMessage({
      id: 'm-finished-sources',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'Here is what I found.',
      toolCalls: [
        { id: 'tc-search', name: 'web_search', arguments: { queries: ['latest models'] } },
      ],
      toolResults: [
        {
          toolCallId: 'tc-search',
          toolName: 'web_search',
          content: 'status: ok\n[1] One\nurl: https://example.com/one\n[2] Two\nurl: https://example.com/two',
          ranAt: Date.now(),
        },
      ],
    });

    expect(rendered.textContent).toContain('Found 2 sources');
    expect(rendered.textContent).not.toContain('Writing answer');
    expect(rendered.textContent).not.toContain('status: ok');
    expect(rendered.textContent).not.toContain('https://example.com/one');
  });

  it('renders tool summaries above collapsed thinking work notes', () => {
    const rendered = renderMessage({
      id: 'm-work-note-sources',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'Final answer.',
      workNotes: ['Pre-tool reasoning that should not look like the answer.'],
      toolCalls: [
        { id: 'tc-search', name: 'web_search', arguments: { queries: ['latest models'] } },
      ],
      toolResults: [
        {
          toolCallId: 'tc-search',
          toolName: 'web_search',
          content: 'status: ok\n[1] One\nurl: https://example.com/one',
          ranAt: Date.now(),
        },
      ],
    });

    const sourceSummary = rendered.querySelector('[aria-label="Searching latest models"]');
    const thinking = rendered.querySelector('[aria-label="Thinking"]');

    expect(sourceSummary).not.toBeNull();
    expect(thinking?.textContent).toContain('Thinking');
    expect(rendered.textContent!.indexOf('Thinking')).toBeLessThan(rendered.textContent!.indexOf('Found 1 source'));
    expect(rendered.querySelector('.activity-row__detail')).toBeNull();
  });

  it('pairs duplicate tool result ids by occurrence in the transcript', () => {
    const rendered = renderMessage({
      id: 'm-duplicate-tools',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'Done.',
      toolCalls: [
        { id: 'dup', name: 'fs', arguments: { action: 'write', path: '/workspace/artifacts/one.html' } },
        { id: 'dup', name: 'fs', arguments: { action: 'write', path: '/workspace/artifacts/two.html' } },
      ],
      toolResults: [
        { toolCallId: 'dup', toolName: 'fs', content: 'Wrote 100 bytes to /workspace/artifacts/one.html', ranAt: Date.now() },
        { toolCallId: 'dup', toolName: 'fs', content: 'Wrote 200 bytes to /workspace/artifacts/two.html', ranAt: Date.now() },
      ],
    });

    expect(rendered.textContent).toContain('Wrote 100 bytes to /workspace/artifacts/one.html');
    expect(rendered.textContent).toContain('Wrote 200 bytes to /workspace/artifacts/two.html');
  });

  it('hides queued image prose while the job card is pending', () => {
    const imageJobs = new ImageJobStore();
    runInAction(() => {
      imageJobs.queue.push({
        id: 'job-pending',
        threadId: 't1',
        prompt: 'a glass city',
        count: 1,
        width: 1024,
        height: 1024,
        backend: 'openrouter-image',
        status: 'pending',
        results: [],
        createdAt: Date.now(),
      });
    });

    const rendered = renderMessage({
      id: 'm-image',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'I queued an image through OpenRouter GPT-5.4 Image 2.',
      toolCalls: [{ id: 'tc-image', name: 'image_generate', arguments: { prompt: 'a glass city' } }],
      toolResults: [{
        toolCallId: 'tc-image',
        toolName: 'image_generate',
        content: 'Queued.',
        ranAt: Date.now(),
        artifacts: [{ kind: 'image-job', jobId: 'job-pending', count: 1 }],
      }],
    }, 'Assistant', false, undefined, imageJobs);

    expect(rendered.textContent).not.toContain('I queued an image through OpenRouter');
    expect(rendered.textContent).toContain('Generating image');
  });

  it('wires assistant regenerate and branch actions', () => {
    const onRegenerate = vi.fn();
    const onBranch = vi.fn();
    const rendered = renderMessage({
      id: 'm-actions-assistant',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'Done.',
    }, 'Assistant', false, undefined, new ImageJobStore(), { onRegenerate, onBranch });

    act(() => {
      (rendered.querySelector('[aria-label="Regenerate response"]') as HTMLButtonElement).click();
      (rendered.querySelector('[aria-label="Branch conversation"]') as HTMLButtonElement).click();
    });

    expect(onRegenerate).toHaveBeenCalledWith('m-actions-assistant');
    expect(onBranch).toHaveBeenCalledWith('m-actions-assistant');
  });

  it('disables mutating message actions while the thread is busy', () => {
    const onRegenerate = vi.fn();
    const onBranch = vi.fn();
    const rendered = renderMessage({
      id: 'm-actions-disabled',
      role: 'assistant',
      createdAt: Date.now(),
      content: 'Done.',
    }, 'Assistant', false, undefined, new ImageJobStore(), {
      actionsDisabled: true,
      onRegenerate,
      onBranch,
    });

    expect((rendered.querySelector('[aria-label="Copy message"]') as HTMLButtonElement).disabled).toBe(false);
    expect((rendered.querySelector('[aria-label="Regenerate response"]') as HTMLButtonElement).disabled).toBe(true);
    expect((rendered.querySelector('[aria-label="Branch conversation"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('disables copy on empty streaming assistant placeholders', () => {
    const rendered = renderMessage({
      id: 'm-empty-streaming-actions',
      role: 'assistant',
      createdAt: Date.now(),
      content: '',
    }, 'Assistant', true);

    expect((rendered.querySelector('[aria-label="Copy message"]') as HTMLButtonElement).disabled).toBe(true);
    expect((rendered.querySelector('[aria-label="Regenerate response"]') as HTMLButtonElement).disabled).toBe(true);
    expect((rendered.querySelector('[aria-label="Branch conversation"]') as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens user edit-and-resend and submits the draft text', () => {
    const onEditAndResend = vi.fn();
    const rendered = renderMessage({
      id: 'm-actions-user',
      role: 'user',
      createdAt: Date.now(),
      content: 'Original prompt',
    }, 'You', false, undefined, new ImageJobStore(), { onEditAndResend });

    act(() => {
      (rendered.querySelector('[aria-label="Edit and resend"]') as HTMLButtonElement).click();
    });

    act(() => {
      Array.from(rendered.querySelectorAll('.message-edit-panel button'))
        .find(button => button.textContent === 'Send branch')!
        .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onEditAndResend).toHaveBeenCalledWith('m-actions-user', 'Original prompt');
  });
});
