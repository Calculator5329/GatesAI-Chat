import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toolRegistry } from '../../../src/services/tools/registry';

const invokeMock = vi.hoisted(() => vi.fn());
const runtimeMock = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  isWebLite: vi.fn(() => false),
  runtimeMode: vi.fn(() => 'desktop'),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('../../../src/core/runtime', () => runtimeMock);

describe('fetch_page tool', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    runtimeMock.isTauri.mockReturnValue(true);
  });

  it('is selected only for desktop turns', () => {
    const desktopNames = toolRegistry.toolDefsForTurn({
      userText: 'read https://example.com',
      bridgeOnline: false,
      desktopRuntime: true,
    }).map(tool => tool.name);
    const webNames = toolRegistry.toolDefsForTurn({
      userText: 'read https://example.com',
      bridgeOnline: false,
      desktopRuntime: false,
    }).map(tool => tool.name);

    expect(desktopNames).toContain('fetch_page');
    expect(webNames).not.toContain('fetch_page');
  });

  it('invokes Tauri and formats source, title, and content', async () => {
    invokeMock.mockResolvedValueOnce({
      final_url: 'https://example.com/article',
      status: 200,
      title: 'Example Article',
      content: 'Readable page text.',
      truncated: false,
      content_type: 'text/html; charset=utf-8',
    });

    const result = await toolRegistry.execute('fetch_page', { url: ' https://example.com/article ' }, baseContext());

    expect(invokeMock).toHaveBeenCalledWith('fetch_page', { url: 'https://example.com/article' });
    expect(result.ok).toBe(true);
    expect(result.summary).toBe('example.com');
    expect(result.content).toContain('Source: https://example.com/article');
    expect(result.content).toContain('Title: Example Article');
    expect(result.content).toContain('Readable page text.');
  });

  it('truncates content to max_chars and caps excessive max_chars', async () => {
    invokeMock.mockResolvedValueOnce({
      final_url: 'https://example.com/long',
      status: 200,
      title: null,
      content: 'a'.repeat(25_000),
      truncated: false,
      content_type: 'text/plain',
    });

    const result = await toolRegistry.execute('fetch_page', {
      url: 'https://example.com/long',
      max_chars: 50_000,
    }, baseContext());

    expect(result.ok).toBe(true);
    expect(result.content).toContain('Title: (untitled)');
    expect(result.content).toContain('content limited to 24000 chars by max_chars');
    expect(result.content).not.toContain('a'.repeat(24_001));
  });

  it('maps blocked private-address failures to readable tool errors', async () => {
    invokeMock.mockRejectedValueOnce('blocked URL: resolved address 169.254.169.254 is not public');

    const result = await toolRegistry.execute('fetch_page', { url: 'https://example.com' }, baseContext());

    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('blocked_private_address');
    expect(result.content).toContain('fetch_page cannot probe private');
    expect(result.retryable).toBe(false);
  });

  it('returns a desktop-only error instead of invoking Tauri in Web Lite', async () => {
    runtimeMock.isTauri.mockReturnValue(false);

    const result = await toolRegistry.execute('fetch_page', { url: 'https://example.com' }, baseContext());

    expect(invokeMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe('desktop_required');
  });
});

function baseContext() {
  return {
    threadId: 't-fetch',
    profile: undefined,
    chat: undefined,
  } as never;
}
