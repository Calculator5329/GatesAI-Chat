// Renders the editorial chat MarkdownChunk surface and its local interaction state.
// Called by EditorialChat, EditorialMessage, or the sidebar shell; depends on RootStore hooks, core message types, and UI primitives.
// Invariant: persisted chat state stays in stores while components derive view state from props/hooks.
import { memo, useSyncExternalStore, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import { isWorkspacePath } from '../../core/workspacePaths';
import type { BridgeStore } from '../../stores/BridgeStore';
import { HtmlArtifactPreview, isHtmlWorkspacePath } from './HtmlArtifactPreview';
import { MermaidDiagram } from './MermaidDiagram';

/**
 * Lazy plugin loader for the heavy rehype plugins. `rehype-highlight` pulls
 * highlight.js and `rehype-katex` pulls katex plus its CSS and font assets.
 * Most messages have no code fences or math, so we only load these when
 * content actually needs them, then notify subscribed MarkdownChunks to
 * re-render with the new plugin set.
 */
type RehypePlugin = PluggableList[number];
let highlightPlugin: RehypePlugin | null = null;
let highlightLoading: Promise<void> | null = null;
let katexPlugin: RehypePlugin | null = null;
let katexLoading: Promise<void> | null = null;
let pluginVersion = 0;
const pluginListeners = new Set<() => void>();

function subscribePlugins(listener: () => void) {
  pluginListeners.add(listener);
  return () => { pluginListeners.delete(listener); };
}
function getPluginVersion() { return pluginVersion; }
function bumpPluginVersion() {
  pluginVersion += 1;
  for (const l of pluginListeners) l();
}

function ensureHighlight() {
  if (highlightPlugin || highlightLoading) return;
  highlightLoading = Promise.all([
    import('rehype-highlight'),
    import('highlight.js/styles/github-dark.css'),
  ]).then(([mod]) => {
    highlightPlugin = mod.default as RehypePlugin;
    bumpPluginVersion();
  }).catch(() => { /* markdown still renders without highlight */ });
}

function ensureKatex() {
  if (katexPlugin || katexLoading) return;
  katexLoading = Promise.all([
    import('rehype-katex'),
    import('katex/dist/katex.min.css'),
  ]).then(([mod]) => {
    katexPlugin = [mod.default, { throwOnError: false, strict: 'ignore' }] as RehypePlugin;
    bumpPluginVersion();
  }).catch(() => { /* markdown still renders without katex */ });
}

const HAS_CODE_FENCE = (s: string) => s.includes('```');
const MATH_RE = /\$\$[\s\S]+?\$\$|\\\(|\\\[/;
const HAS_MATH = (s: string) => MATH_RE.test(s);

export interface MarkdownChunkProps {
  content: string;
  bridge: BridgeStore;
}

/**
 * Memoized by content string. While streaming, closed chunks pass identical
 * strings on every token flush and skip re-rendering the heavy markdown tree.
 */
export const MarkdownChunk = memo(function MarkdownChunk({ content, bridge }: MarkdownChunkProps) {
  useSyncExternalStore(subscribePlugins, getPluginVersion, getPluginVersion);

  const needsHighlight = HAS_CODE_FENCE(content);
  const needsKatex = HAS_MATH(content);
  if (needsHighlight && !highlightPlugin) ensureHighlight();
  if (needsKatex && !katexPlugin) ensureKatex();

  const rehypePlugins: PluggableList = [];
  if (needsHighlight && highlightPlugin) rehypePlugins.push(highlightPlugin);
  if (needsKatex && katexPlugin) rehypePlugins.push(katexPlugin);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
      rehypePlugins={rehypePlugins}
      components={{
        code: (props) => <CodeOrWorkspaceLink {...props} bridge={bridge} />,
        a: (props) => <AnchorOrWorkspaceLink {...props} bridge={bridge} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

interface CodeProps extends ComponentPropsWithoutRef<'code'> {
  bridge: BridgeStore;
}

function CodeOrWorkspaceLink({ bridge, className, children, ...rest }: CodeProps) {
  const isInline = !className;
  const text = childrenToString(children).replace(/\n$/, '');
  if (isInline && isWorkspacePath(text)) {
    if (isHtmlWorkspacePath(text)) {
      return <HtmlArtifactPreview path={text} />;
    }
    return <WorkspacePathLink path={text} bridge={bridge} />;
  }
  if (/\blanguage-mermaid\b/.test(className ?? '')) {
    return <MermaidDiagram source={text} />;
  }
  return <code className={className} {...rest}>{children}</code>;
}

interface AnchorProps extends ComponentPropsWithoutRef<'a'> {
  bridge: BridgeStore;
}

function AnchorOrWorkspaceLink({ bridge, href, children, ...rest }: AnchorProps) {
  const target = typeof href === 'string' ? href : '';
  if (target && isWorkspacePath(target)) {
    if (isHtmlWorkspacePath(target)) {
      return <HtmlArtifactPreview path={target} label={childrenToString(children)} />;
    }
    return <WorkspacePathLink path={target} bridge={bridge} />;
  }
  return <a href={href} {...rest} target="_blank" rel="noreferrer">{children}</a>;
}

function WorkspacePathLink({ path, bridge }: { path: string; bridge: BridgeStore }) {
  return (
    <button
      type="button"
      className="workspace-path-link"
      title={`Open ${path}`}
      onClick={(event) => {
        event.stopPropagation();
        void bridge.openWorkspacePath(path);
      }}
    >
      <span className="workspace-path-link__glyph" aria-hidden="true">-&gt;</span>
      <code>{path}</code>
    </button>
  );
}

function childrenToString(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(childrenToString).join('');
  return '';
}
