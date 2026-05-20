import type { ReactNode } from 'react';
import { isWorkspacePath } from '../../core/workspacePaths';
import type { BridgeStore } from '../../stores/BridgeStore';
import { HtmlArtifactPreview, isHtmlWorkspacePath } from './HtmlArtifactPreview';
import { MermaidDiagram } from './MermaidDiagram';

const INLINE_TOKEN_RE = /(`[^`]+`|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*)/g;
const MERMAID_FENCE_RE = /^```mermaid\s*\n([\s\S]*?)\n```$/;

export function MarkdownFallback({ content, bridge }: { content: string; bridge?: BridgeStore }) {
  const mermaid = content.trim().match(MERMAID_FENCE_RE);
  if (mermaid) return <MermaidDiagram source={mermaid[1]} />;
  return <>{renderInline(content, bridge)}</>;
}

function renderInline(content: string, bridge: BridgeStore | undefined): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_TOKEN_RE.lastIndex = 0;
  while ((match = INLINE_TOKEN_RE.exec(content))) {
    if (match.index > lastIndex) nodes.push(content.slice(lastIndex, match.index));
    const token = match[0];
    const linkLabel = match[2];
    const linkHref = match[3];
    const boldText = match[4];
    if (token.startsWith('`')) {
      const text = token.slice(1, -1);
      nodes.push(renderCode(text, bridge, match.index));
    } else if (linkLabel && linkHref) {
      nodes.push(renderLink(linkLabel, linkHref, bridge, match.index));
    } else if (boldText) {
      nodes.push(<strong key={`strong-${match.index}`}>{boldText}</strong>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < content.length) nodes.push(content.slice(lastIndex));
  return nodes;
}

function renderCode(text: string, bridge: BridgeStore | undefined, key: number): ReactNode {
  if (isWorkspacePath(text)) {
    if (isHtmlWorkspacePath(text)) return <HtmlArtifactPreview key={`html-code-${key}`} path={text} />;
    if (bridge) return <WorkspacePathLink key={`workspace-code-${key}`} path={text} bridge={bridge} />;
  }
  return <code key={`code-${key}`}>{text}</code>;
}

function renderLink(label: string, href: string, bridge: BridgeStore | undefined, key: number): ReactNode {
  if (isWorkspacePath(href)) {
    if (isHtmlWorkspacePath(href)) {
      return <HtmlArtifactPreview key={`html-link-${key}`} path={href} label={label} />;
    }
    if (bridge) return <WorkspacePathLink key={`workspace-link-${key}`} path={href} bridge={bridge} />;
  }
  return <a key={`link-${key}`} href={href} target="_blank" rel="noreferrer">{label}</a>;
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
