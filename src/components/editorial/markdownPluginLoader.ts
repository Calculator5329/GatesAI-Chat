import type { PluggableList } from 'unified';

export type RehypePlugin = PluggableList[number];

export interface MarkdownPluginLoader {
  get(): RehypePlugin | null;
  load(): Promise<RehypePlugin | null>;
  subscribe(listener: () => void): () => void;
}

export function createMarkdownPluginLoader(
  loadPlugin: () => Promise<RehypePlugin>,
): MarkdownPluginLoader {
  let plugin: RehypePlugin | null = null;
  let loading: Promise<RehypePlugin | null> | null = null;
  const listeners = new Set<() => void>();

  return {
    get: () => plugin,
    load: () => {
      if (plugin) return Promise.resolve(plugin);
      if (loading) return loading;
      loading = loadPlugin().then(loaded => {
        plugin = loaded;
        for (const listener of listeners) listener();
        return loaded;
      }).catch(() => null);
      return loading;
    },
    subscribe: (listener) => {
      if (plugin) return () => {};
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

export const highlightPluginLoader = createMarkdownPluginLoader(async () => {
  const [mod] = await Promise.all([
    import('rehype-highlight'),
    import('highlight.js/styles/github-dark.css'),
  ]);
  return [mod.default, { ignoreMissing: true }] as RehypePlugin;
});

export const katexPluginLoader = createMarkdownPluginLoader(async () => {
  const [mod] = await Promise.all([
    import('rehype-katex'),
    import('katex/dist/katex.min.css'),
  ]);
  return [mod.default, { throwOnError: false, strict: 'ignore' }] as RehypePlugin;
});
