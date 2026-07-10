// The full markdown block renderer (react-markdown + GFM/math) with
// workspace-aware links, code blocks, and embedded diagram/artifact previews.
// Lazy-loaded by EditorialMessage. Presentation only.
import { Children, isValidElement, memo, useCallback, useEffect, useState, useSyncExternalStore, type ComponentPropsWithoutRef, type ReactElement, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import type { PluggableList } from 'unified';
import { isWorkspacePath } from '../../core/workspacePaths';
import type { BridgeStore } from '../../stores/BridgeStore';
import { HtmlArtifactPreview, isHtmlWorkspacePath } from './HtmlArtifactPreview';
import { MermaidDiagram } from './MermaidDiagram';
import {
  highlightPluginLoader,
  katexPluginLoader,
  type MarkdownPluginLoader,
  type RehypePlugin,
} from './markdownPluginLoader';

const HAS_CODE_FENCE = (s: string) => s.includes('```');
const MATH_RE = /\$\$[\s\S]+?\$\$|\\\(|\\\[/;
const HAS_MATH = (s: string) => MATH_RE.test(s);

export interface MarkdownChunkProps {
  content: string;
  bridge: BridgeStore;
  lineNumbers: boolean;
  onLineNumbersChange: (enabled: boolean) => void;
}

/**
 * Memoized by content string. While streaming, closed chunks pass identical
 * strings on every token flush and skip re-rendering the heavy markdown tree.
 */
export const MarkdownChunk = memo(function MarkdownChunk({ content, bridge, lineNumbers, onLineNumbersChange }: MarkdownChunkProps) {
  const needsHighlight = HAS_CODE_FENCE(content);
  const needsKatex = HAS_MATH(content);
  const highlightPlugin = useLazyRehypePlugin(highlightPluginLoader, needsHighlight);
  const katexPlugin = useLazyRehypePlugin(katexPluginLoader, needsKatex);

  const rehypePlugins: PluggableList = [];
  if (needsHighlight && highlightPlugin) rehypePlugins.push(highlightPlugin);
  if (needsKatex && katexPlugin) rehypePlugins.push(katexPlugin);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
      rehypePlugins={rehypePlugins}
      components={{
        code: (props) => <CodeOrWorkspaceLink {...props} bridge={bridge} />,
        pre: (props) => <CodeBlock {...props} lineNumbers={lineNumbers} onLineNumbersChange={onLineNumbersChange} />,
        a: (props) => <AnchorOrWorkspaceLink {...props} bridge={bridge} />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
});

interface CodeBlockProps extends ComponentPropsWithoutRef<'pre'> {
  lineNumbers: boolean;
  onLineNumbersChange: (enabled: boolean) => void;
}

function CodeBlock({ children, lineNumbers, onLineNumbersChange, ...rest }: CodeBlockProps) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const child = Children.only(children);
  if (!isValidElement(child) || child.type !== 'code') return <pre {...rest}>{children}</pre>;

  const code = child as ReactElement<ComponentPropsWithoutRef<'code'>>;
  const language = languageLabelFromClassName(code.props.className);
  const text = childrenToString(code.props.children).replace(/\n$/, '');
  const lineCount = text.split('\n').length;

  return (
    <div className="code-block">
      <div className="code-block__toolbar">
        <span className="code-block__language">{language ?? 'Code'}</span>
        <button type="button" aria-pressed={lineNumbers} onClick={() => onLineNumbersChange(!lineNumbers)}>
          {lineNumbers ? 'Hide lines' : 'Show lines'}
        </button>
        <button
          type="button"
          onClick={async () => {
            const copied = await copyCodeToClipboard(text);
            setCopyState(copied ? 'copied' : 'failed');
          }}
        >
          {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
        </button>
      </div>
      <div className={`code-block__body${lineNumbers ? ' code-block__body--numbered' : ''}`}>
        {lineNumbers && (
          <span className="code-block__line-numbers" aria-hidden="true">
            {Array.from({ length: lineCount }, (_, index) => <span key={index}>{index + 1}</span>)}
          </span>
        )}
        <pre {...rest}>{code}</pre>
      </div>
    </div>
  );
}

export function languageLabelFromClassName(className?: string): string | null {
  const token = className?.split(/\s+/).find(value => value.startsWith('language-'));
  const language = token?.slice('language-'.length).trim();
  return language || null;
}

export async function copyCodeToClipboard(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function useLazyRehypePlugin(loader: MarkdownPluginLoader, enabled: boolean): RehypePlugin | null {
  const subscribe = useCallback((listener: () => void) => {
    return enabled ? loader.subscribe(listener) : () => {};
  }, [enabled, loader]);
  const getSnapshot = useCallback(() => {
    return enabled ? loader.get() : null;
  }, [enabled, loader]);
  const plugin = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  useEffect(() => {
    if (enabled && !plugin) void loader.load();
  }, [enabled, loader, plugin]);

  return plugin;
}

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
  if (isValidElement<{ children?: ReactNode }>(children)) return childrenToString(children.props.children);
  return '';
}
