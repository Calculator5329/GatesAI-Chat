import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { runInAction } from 'mobx';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreProvider } from '../../../src/stores/context';
import { UiStore } from '../../../src/stores/UiStore';
import { ExecStreamStore } from '../../../src/stores/ExecStreamStore';
import { ImageJobStore } from '../../../src/stores/ImageJobStore';
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

function renderMessage(
  message: Parameters<typeof EditorialMessage>[0]['message'],
  modelName = 'Assistant',
  streaming = false,
  preTokenLabel?: Parameters<typeof EditorialMessage>[0]['preTokenLabel'],
  imageJobs = new ImageJobStore(),
): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);

  const store = {
    ui: new UiStore(),
    execStream: new ExecStreamStore(),
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

  act(() => {
    root!.render(
      createElement(StoreProvider, {
        store,
        children: createElement(EditorialMessage, {
          modelName,
          streaming,
          preTokenLabel,
          message,
        }),
      }),
    );
  });
  return host;
}

afterEach(() => {
  if (root) {
    act(() => root?.unmount());
  }
  root = null;
  host?.remove();
  host = null;
  __htmlArtifactPreviewTestApi.reset();
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
    expect(rendered.querySelector('[aria-label="Working"]')).not.toBeNull();
  });

  it('renders active assistant streams as markdown with a working indicator', () => {
    const streaming = renderMessage({
      id: 'm-active-stream',
      role: 'assistant',
      createdAt: Date.now(),
      content: '**bold so far**',
    }, 'Assistant', true);

    expect(streaming.querySelector('.streaming-plain-text')).toBeNull();
    expect(streaming.querySelector('strong')?.textContent).toBe('bold so far');
    expect(streaming.textContent).toContain('working');
    expect(streaming.querySelector('[aria-label="Working"]')).not.toBeNull();
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

  it('can label an empty streaming assistant message as responding', () => {
    const rendered = renderMessage({
      id: 'm-responding',
      role: 'assistant',
      createdAt: Date.now(),
      content: '',
    }, 'Assistant', true, 'responding');

    expect(rendered.textContent).toContain('responding');
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

    expect(rendered.textContent).toContain('compacting');
    expect(rendered.querySelector('[aria-label="Compacting"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Thinking"]')).toBeNull();
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
    expect(rendered.textContent).toContain('waiting on');
  });
});
