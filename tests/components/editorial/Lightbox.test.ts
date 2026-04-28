import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Lightbox } from '../../../src/components/editorial/Lightbox';
import { StoreProvider } from '../../../src/stores/context';
import type { RootStore } from '../../../src/stores/RootStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderLightbox(prompt: string, path = '/workspace/artifacts/a.png'): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const bridge = {
    readAttachmentBase64: async () => ({ base64: 'AQID', mime: 'image/png', size: 3 }),
    openWorkspacePath: async () => true,
  };
  act(() => {
    root!.render(
      createElement(StoreProvider, {
        store: { bridge } as unknown as RootStore,
        children: createElement(Lightbox, {
          images: [{ path, alt: 'rendered image' }],
          startIndex: 0,
          prompt,
          onClose: () => undefined,
        }),
      }),
    );
  });
  return host;
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function nextTick(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

beforeEach(() => {
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn(async () => undefined) },
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
  vi.restoreAllMocks();
});

describe('Lightbox prompt controls', () => {
  it('shows the full prompt and copies it exactly', async () => {
    const prompt = 'A cinematic close-up portrait with many specific lighting, lens, wardrobe, and background details.';
    const rendered = renderLightbox(prompt);
    await act(async () => {
      for (let i = 0; i < 5; i++) {
        await flushMicrotasks();
        await nextTick();
      }
    });

    const promptField = rendered.querySelector('textarea[aria-label="Full prompt"]') as HTMLTextAreaElement | null;
    expect(promptField?.value).toBe(prompt);

    const copy = Array.from(rendered.querySelectorAll('button'))
      .find(button => button.textContent === 'Copy prompt') as HTMLButtonElement | undefined;
    expect(copy).toBeDefined();

    await act(async () => {
      copy!.click();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(prompt);
  });

  it('converts hosted image URLs to data URLs before rendering', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { 'content-type': 'image/png' },
    }));
    const rendered = renderLightbox('prompt', 'http://127.0.0.1:8188/view?filename=a.png&type=output');

    await act(async () => {
      await flushMicrotasks();
    });

    const img = rendered.querySelector('img') as HTMLImageElement | null;
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:8188/view?filename=a.png&type=output');
    expect(img?.src).toMatch(/^data:image\/png;base64,/);
  });
});
