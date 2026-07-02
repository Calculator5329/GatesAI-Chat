import { describe, expect, it, vi } from 'vitest';
import { createMarkdownPluginLoader, type RehypePlugin } from '../../../src/components/editorial/markdownPluginLoader';

describe('createMarkdownPluginLoader', () => {
  it('uses one in-flight promise and notifies subscribers with the resolved plugin', async () => {
    const plugin = (() => {}) as RehypePlugin;
    const loadPlugin = vi.fn(async () => plugin);
    const loader = createMarkdownPluginLoader(loadPlugin);
    const listener = vi.fn();
    const unsubscribe = loader.subscribe(listener);

    const first = loader.load();
    const second = loader.load();

    expect(first).toBe(second);
    expect(loadPlugin).toHaveBeenCalledTimes(1);
    await expect(first).resolves.toBe(plugin);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(loader.get()).toBe(plugin);

    unsubscribe();
  });

  it('returns an already-loaded plugin synchronously and avoids new subscriptions', async () => {
    const plugin = (() => {}) as RehypePlugin;
    const loader = createMarkdownPluginLoader(async () => plugin);

    await loader.load();
    const listener = vi.fn();
    const unsubscribe = loader.subscribe(listener);

    expect(loader.get()).toBe(plugin);
    await expect(loader.load()).resolves.toBe(plugin);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });
});
