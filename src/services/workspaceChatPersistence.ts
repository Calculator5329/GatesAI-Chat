import type { AssistantMessage, ChatSnapshot, Message, MessageAttachmentRef, Thread, ToolResultArtifact } from '../core/types';
import type { FsListResp, FsReadResp } from '../core/workspace';
import {
  parseChatSnapshotValue,
  prepareChatSnapshotForSave,
} from './persistence';
import type { BridgeClientFacade } from './tools/types';

export const WORKSPACE_CHAT_DIR = '/workspace/.gatesai/chat';
export const WORKSPACE_CHAT_STATE_PATH = `${WORKSPACE_CHAT_DIR}/state.v1.json`;
export const WORKSPACE_CHAT_LIBRARY_DIR = '/workspace/chat-history';
export const WORKSPACE_CHAT_LIBRARY_INDEX_PATH = `${WORKSPACE_CHAT_LIBRARY_DIR}/index.html`;
const WORKSPACE_CHAT_TMP_PATH = `${WORKSPACE_CHAT_STATE_PATH}.tmp`;
const WORKSPACE_CHAT_LIBRARY_CONVERSATIONS_DIR = `${WORKSPACE_CHAT_LIBRARY_DIR}/conversations`;

export interface WorkspaceChatSnapshotEnvelope {
  version: 1;
  savedAt: string;
  snapshot: ChatSnapshot;
  source?: 'workspace' | 'localStorage-migration' | 'local-newer-than-workspace';
}

export type WorkspaceChatLoadResult =
  | { kind: 'loaded'; snapshot: ChatSnapshot; envelope: WorkspaceChatSnapshotEnvelope }
  | { kind: 'missing' }
  | { kind: 'malformed'; raw: string; error: string };

export interface WorkspaceChatPersistence {
  load(): Promise<WorkspaceChatLoadResult>;
  save(snapshot: ChatSnapshot, source?: WorkspaceChatSnapshotEnvelope['source']): Promise<void>;
  backupMalformed(raw: string): Promise<string>;
}

export function createWorkspaceChatPersistence(client: BridgeClientFacade): WorkspaceChatPersistence {
  return {
    async load(): Promise<WorkspaceChatLoadResult> {
      await ensureDir(client);
      let raw = '';
      try {
        const resp = await client.request<FsReadResp>('fs.read', {
          path: WORKSPACE_CHAT_STATE_PATH,
          encoding: 'utf8',
        });
        raw = resp.content;
      } catch (err) {
        if (isMissingWorkspaceStateError(err)) return { kind: 'missing' };
        throw err;
      }

      try {
        const parsed = JSON.parse(raw) as unknown;
        const envelope = parseEnvelope(parsed);
        if (!envelope) {
          return { kind: 'malformed', raw, error: 'Invalid workspace chat snapshot envelope.' };
        }
        return { kind: 'loaded', snapshot: envelope.snapshot, envelope };
      } catch (err) {
        return { kind: 'malformed', raw, error: (err as Error).message };
      }
    },

    async save(snapshot: ChatSnapshot, source = 'workspace'): Promise<void> {
      await ensureDir(client);
      const savedAt = new Date().toISOString();
      const envelope: WorkspaceChatSnapshotEnvelope = {
        version: 1,
        savedAt,
        source,
        snapshot: prepareChatSnapshotForSave(snapshot),
      };
      const raw = JSON.stringify(envelope);
      await client.request('fs.write', {
        path: WORKSPACE_CHAT_TMP_PATH,
        content: raw,
        encoding: 'utf8',
      });
      try {
        await client.request('fs.move', {
          from: WORKSPACE_CHAT_TMP_PATH,
          to: WORKSPACE_CHAT_STATE_PATH,
        });
      } catch {
        await client.request('fs.write', {
          path: WORKSPACE_CHAT_STATE_PATH,
          content: raw,
          encoding: 'utf8',
        });
      }
      await saveReadableChatLibrary(client, envelope.snapshot, savedAt);
    },

    async backupMalformed(raw: string): Promise<string> {
      await ensureDir(client);
      const path = `${WORKSPACE_CHAT_DIR}/malformed-${timestampForPath()}.json`;
      await client.request('fs.write', { path, content: raw, encoding: 'utf8' });
      return path;
    },
  };
}

async function ensureDir(client: BridgeClientFacade): Promise<void> {
  await client.request('fs.mkdir', { path: WORKSPACE_CHAT_DIR });
}

async function saveReadableChatLibrary(client: BridgeClientFacade, snapshot: ChatSnapshot, savedAt: string): Promise<void> {
  try {
    await client.request('fs.mkdir', { path: WORKSPACE_CHAT_LIBRARY_DIR });
    await client.request('fs.mkdir', { path: WORKSPACE_CHAT_LIBRARY_CONVERSATIONS_DIR });
    const threads = snapshot.threads
      .filter(thread => thread.deletedAt == null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
    const entries = threads.map(thread => ({
      thread,
      baseName: conversationFileBaseName(thread),
    }));

    await client.request('fs.write', {
      path: WORKSPACE_CHAT_LIBRARY_INDEX_PATH,
      content: renderLibraryIndex(entries, savedAt),
      encoding: 'utf8',
    });

    const expectedConversationPaths = new Set<string>();
    for (const entry of entries) {
      const htmlPath = `${WORKSPACE_CHAT_LIBRARY_CONVERSATIONS_DIR}/${entry.baseName}.html`;
      const markdownPath = `${WORKSPACE_CHAT_LIBRARY_CONVERSATIONS_DIR}/${entry.baseName}.md`;
      expectedConversationPaths.add(htmlPath);
      expectedConversationPaths.add(markdownPath);
      await client.request('fs.write', {
        path: htmlPath,
        content: renderConversationHtml(entry.thread, savedAt),
        encoding: 'utf8',
      });
      await client.request('fs.write', {
        path: markdownPath,
        content: renderConversationMarkdown(entry.thread, savedAt),
        encoding: 'utf8',
      });
    }
    await pruneStaleConversationFiles(client, expectedConversationPaths);
  } catch (err) {
    console.warn('[persistence] failed to save readable chat history library', err);
  }
}

async function pruneStaleConversationFiles(client: BridgeClientFacade, expectedPaths: Set<string>): Promise<void> {
  const resp = await client.request<FsListResp>('fs.list', {
    path: WORKSPACE_CHAT_LIBRARY_CONVERSATIONS_DIR,
  });
  const entries = Array.isArray(resp.entries) ? resp.entries : [];
  for (const entry of entries) {
    if (entry.kind !== 'file') continue;
    if (!/\.html?$/i.test(entry.path) && !/\.md$/i.test(entry.path)) continue;
    if (expectedPaths.has(entry.path)) continue;
    await client.request('fs.delete', { path: entry.path });
  }
}

function parseEnvelope(value: unknown): WorkspaceChatSnapshotEnvelope | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { version?: unknown; savedAt?: unknown; snapshot?: unknown; source?: unknown };
  if (record.version !== 1 || typeof record.savedAt !== 'string') return null;
  if (
    record.source != null &&
    record.source !== 'workspace' &&
    record.source !== 'localStorage-migration' &&
    record.source !== 'local-newer-than-workspace'
  ) return null;
  const snapshot = parseChatSnapshotValue(record.snapshot);
  if (!snapshot) return null;
  return {
    version: 1,
    savedAt: record.savedAt,
    snapshot,
    ...(record.source ? { source: record.source } : {}),
  };
}

function isMissingWorkspaceStateError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err ?? '');
  return /\b(not found|no such file|does not exist)\b/i.test(message);
}

function timestampForPath(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function conversationFileBaseName(thread: Thread): string {
  const title = thread.title.trim() || 'Untitled conversation';
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'untitled-conversation';
  return `${slug}-${safePathSegment(thread.id)}`;
}

function safePathSegment(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'thread';
}

function renderLibraryIndex(entries: Array<{ thread: Thread; baseName: string }>, savedAt: string): string {
  const groups = groupEntriesByPeriod(entries);
  const groupsHtml = groups.map(group => {
    const rows = group.entries.map(({ thread, baseName }) => {
      const title = thread.title.trim() || 'Untitled conversation';
      const summary = thread.summary?.trim()
        || thread.threadContext?.trim()
        || firstMessageSnippet(thread)
        || '';
      const searchText = [
        title,
        thread.id,
        thread.summary ?? '',
        thread.threadContext ?? '',
        ...thread.messages.map(message => message.content),
      ].join(' ');
      const href = `conversations/${escapeAttr(baseName)}.html`;
      const mdHref = `conversations/${escapeAttr(baseName)}.md`;
      return `<li class="entry" data-search="${escapeAttr(searchText)}">
        <a class="entry-link" href="${href}">
          <div class="entry-main">
            <h2 class="entry-title">${escapeHtml(title)}</h2>
            ${summary ? `<p class="entry-summary">${escapeHtml(summary)}</p>` : ''}
            <div class="entry-meta">
              <span>${escapeHtml(formatLibraryDate(thread.updatedAt))}</span>
              <span class="sep" aria-hidden="true">·</span>
              <span>${thread.messages.length} message${thread.messages.length === 1 ? '' : 's'}</span>
              <span class="sep" aria-hidden="true">·</span>
              <code>${escapeHtml(thread.id)}</code>
            </div>
          </div>
          <span class="entry-chev" aria-hidden="true">→</span>
        </a>
        <a class="entry-md" href="${mdHref}" title="Open as Markdown" aria-label="Open ${escapeAttr(title)} as Markdown">md</a>
      </li>`;
    }).join('\n');
    return `<section class="group" data-group="${escapeAttr(group.key)}">
      <header class="group-head">
        <span class="group-label">${escapeHtml(group.label)}</span>
        <span class="group-rule" aria-hidden="true"></span>
        <span class="group-count">${group.entries.length}</span>
      </header>
      <ol class="entries">${rows}</ol>
    </section>`;
  }).join('\n');
  const messageCount = entries.reduce((sum, entry) => sum + entry.thread.messages.length, 0);

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Chat History · GatesAI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400&display=swap" rel="stylesheet">
  ${libraryStyle()}
</head>
<body>
  <div class="bg-veil" aria-hidden="true"></div>
  <main class="shell">
    <header class="page-head">
      <div class="brand">
        <span class="brand-name">GatesAI</span>
        <span class="brand-dot" aria-hidden="true"></span>
      </div>
      <div class="page-head-meta">
        <span>${entries.length} conversation${entries.length === 1 ? '' : 's'}</span>
        <span class="sep" aria-hidden="true">·</span>
        <span>${messageCount} message${messageCount === 1 ? '' : 's'}</span>
      </div>
    </header>
    <section class="hero">
      <p class="eyebrow">Chat history</p>
      <h1>A record of every conversation.</h1>
      <p class="dek">Saved as readable HTML and Markdown. The app keeps its own JSON snapshot separately.</p>
    </section>
    <section class="toolbar">
      <div class="search-wrap">
        <svg class="search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>
        <input id="search" type="search" placeholder="Search conversations" autocomplete="off" aria-label="Search conversations">
        <kbd class="kbd" aria-hidden="true">/</kbd>
      </div>
    </section>
    <section id="library" class="library">
      ${groupsHtml || '<p class="empty">No conversations yet. Start chatting and they will appear here.</p>'}
    </section>
    <p class="empty hidden" id="no-results">No conversations match your search.</p>
    <footer class="page-foot">
      <span>GatesAI</span>
      <span class="sep" aria-hidden="true">·</span>
      <span>Last saved ${escapeHtml(savedAt)}</span>
    </footer>
  </main>
  <script>
    (() => {
      const search = document.getElementById('search');
      const entries = [...document.querySelectorAll('.entry')];
      const groups = [...document.querySelectorAll('.group')];
      const noResults = document.getElementById('no-results');
      const library = document.getElementById('library');
      function applyFilter() {
        const q = (search.value || '').trim().toLowerCase();
        let totalVisible = 0;
        for (const group of groups) {
          let visible = 0;
          for (const entry of group.querySelectorAll('.entry')) {
            const match = q.length === 0 || (entry.dataset.search || '').toLowerCase().includes(q);
            entry.hidden = !match;
            if (match) visible++;
          }
          group.hidden = visible === 0;
          totalVisible += visible;
        }
        if (noResults) noResults.classList.toggle('hidden', totalVisible > 0);
        if (library) library.classList.toggle('hidden', totalVisible === 0 && q.length > 0);
      }
      search?.addEventListener('input', applyFilter);
      document.addEventListener('keydown', (e) => {
        if (e.key === '/' && document.activeElement !== search && !e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          search?.focus();
        }
        if (e.key === 'Escape' && document.activeElement === search) {
          search.value = '';
          applyFilter();
          search.blur();
        }
      });
    })();
  </script>
</body>
</html>`;
}

interface LibraryGroup {
  key: string;
  label: string;
  entries: Array<{ thread: Thread; baseName: string }>;
}

function groupEntriesByPeriod(entries: Array<{ thread: Thread; baseName: string }>): LibraryGroup[] {
  const now = Date.now();
  const today = startOfLocalDay(now);
  const yesterday = today - 24 * 60 * 60 * 1000;
  const last7 = today - 7 * 24 * 60 * 60 * 1000;
  const last30 = today - 30 * 24 * 60 * 60 * 1000;
  const buckets: Record<string, LibraryGroup> = {
    today: { key: 'today', label: 'Today', entries: [] },
    yesterday: { key: 'yesterday', label: 'Yesterday', entries: [] },
    week: { key: 'week', label: 'Last 7 days', entries: [] },
    month: { key: 'month', label: 'Last 30 days', entries: [] },
    earlier: { key: 'earlier', label: 'Earlier', entries: [] },
  };
  for (const entry of entries) {
    const t = entry.thread.updatedAt;
    if (t >= today) buckets.today.entries.push(entry);
    else if (t >= yesterday) buckets.yesterday.entries.push(entry);
    else if (t >= last7) buckets.week.entries.push(entry);
    else if (t >= last30) buckets.month.entries.push(entry);
    else buckets.earlier.entries.push(entry);
  }
  return Object.values(buckets).filter(group => group.entries.length > 0);
}

function startOfLocalDay(ms: number): number {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function formatLibraryDate(ms: number): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dayMs = startOfLocalDay(ms);
  const today = startOfLocalDay(Date.now());
  if (dayMs === today) return time;
  if (dayMs === today - 24 * 60 * 60 * 1000) return `Yesterday · ${time}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })} · ${time}`;
}

function renderConversationHtml(thread: Thread, savedAt: string): string {
  const title = thread.title.trim() || 'Untitled conversation';
  const messages = thread.messages.map(message => renderMessageHtml(message)).join('\n');
  const context = thread.threadContext?.trim()
    ? `<section class="note"><h2>Context</h2><p>${escapeHtml(thread.threadContext)}</p></section>`
    : '';
  const summary = thread.summary?.trim()
    ? `<section class="note"><h2>Summary</h2><p>${escapeHtml(thread.summary)}</p></section>`
    : '';
  const createdShort = escapeHtml(formatLibraryDate(thread.createdAt));
  const updatedShort = escapeHtml(formatLibraryDate(thread.updatedAt));
  const dateRange = thread.createdAt === thread.updatedAt
    ? createdShort
    : `${createdShort} — ${updatedShort}`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)} · GatesAI</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Geist+Mono:wght@400;500&family=Source+Serif+4:ital,opsz,wght@0,8..60,400;0,8..60,500;0,8..60,600;1,8..60,400&display=swap" rel="stylesheet">
  ${libraryStyle()}
</head>
<body>
  <div class="bg-veil" aria-hidden="true"></div>
  <main class="shell conversation">
    <header class="page-head">
      <a class="brand brand-link" href="../index.html" title="Back to library">
        <span class="brand-name">GatesAI</span>
        <span class="brand-dot" aria-hidden="true"></span>
      </a>
      <nav class="topnav">
        <a class="topnav-link back" href="../index.html"><span aria-hidden="true">←</span><span>Library</span></a>
        <a class="topnav-link" href="${escapeAttr(`${conversationFileBaseName(thread)}.md`)}">Markdown</a>
      </nav>
    </header>
    <section class="hero conversation-hero">
      <p class="eyebrow">Conversation</p>
      <h1>${escapeHtml(title)}</h1>
      <dl class="thread-meta">
        <div><dt>Range</dt><dd>${dateRange}</dd></div>
        <div><dt>Messages</dt><dd>${thread.messages.length}</dd></div>
        <div><dt>Thread</dt><dd><code>${escapeHtml(thread.id)}</code></dd></div>
        <div><dt>Saved</dt><dd><span class="saved-dot" aria-hidden="true"></span><time>${escapeHtml(formatLibraryDate(Date.parse(savedAt)))}</time></dd></div>
      </dl>
    </section>
    ${summary}
    ${context}
    <article class="transcript">
      ${messages || '<p class="empty">No messages yet.</p>'}
    </article>
    <aside class="raw-block">
      <details>
        <summary><span class="raw-summary"><span class="raw-title">Raw transcript</span><span class="raw-hint">Plain text · click to expand</span></span></summary>
        <pre>${escapeHtml(formatThreadPlainText(thread))}</pre>
      </details>
    </aside>
    <footer class="page-foot">
      <a class="foot-link" href="../index.html"><span aria-hidden="true">←</span> All conversations</a>
      <span class="sep" aria-hidden="true">·</span>
      <code>${escapeHtml(thread.id)}</code>
    </footer>
  </main>
</body>
</html>`;
}

function renderMessageHtml(message: Message): string {
  const assistant = message.role === 'assistant' ? message as AssistantMessage : null;
  const attachments = message.role === 'user' ? renderUserAttachmentsHtml(message.attachments) : '';
  const artifacts = assistant ? renderToolArtifactsHtml(assistant.toolResults?.flatMap(result => result.artifacts ?? []) ?? []) : '';
  const extras = assistant ? [
    artifacts,
    ...(assistant.toolCalls?.length ? [`<details><summary>Tool calls (${assistant.toolCalls.length})</summary><pre>${escapeHtml(JSON.stringify(assistant.toolCalls, null, 2))}</pre></details>`] : []),
    ...(assistant.toolResults?.length ? [`<details><summary>Tool results (${assistant.toolResults.length})</summary><pre>${escapeHtml(JSON.stringify(assistant.toolResults, null, 2))}</pre></details>`] : []),
  ].join('') : '';
  const roleLabel = message.role === 'user' ? 'You' : 'Assistant';
  const when = formatMessageTime(message.createdAt);
  return `<section class="message message--${message.role}">
    <header class="message-kicker">
      <span class="role">${roleLabel}</span>
      <span class="sep" aria-hidden="true">·</span>
      <time>${escapeHtml(when)}</time>
    </header>
    <div class="message-content"><pre>${escapeHtml(message.content)}</pre></div>
    ${attachments}
    ${extras}
  </section>`;
}

function formatMessageTime(ms: number): string {
  const date = new Date(ms);
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dayMs = startOfLocalDay(ms);
  const today = startOfLocalDay(Date.now());
  if (dayMs === today) return time;
  if (dayMs === today - 24 * 60 * 60 * 1000) return `Yesterday ${time}`;
  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })} · ${time}`;
}

function renderUserAttachmentsHtml(attachments: MessageAttachmentRef[] | undefined): string {
  if (!attachments?.length) return '';
  const items = attachments.map(attachment => renderFileReferenceHtml({
    path: attachment.path,
    label: attachment.name,
    mime: attachment.mime,
    detail: `${formatBytes(attachment.size)} · ${attachment.mime || 'file'}`,
  })).join('');
  return `<section class="files"><h3>Attachments</h3>${items}</section>`;
}

function renderToolArtifactsHtml(artifacts: ToolResultArtifact[]): string {
  if (artifacts.length === 0) return '';
  const items = artifacts.map(artifact => {
    if (artifact.kind === 'image') {
      return renderFileReferenceHtml({
        path: artifact.path,
        label: fileNameFromPath(artifact.path),
        mime: artifact.mime,
        detail: artifact.mime,
      });
    }
    return `<div class="file-ref"><div><b>Image job</b><span>${escapeHtml(artifact.jobId)} · ${artifact.count} expected image${artifact.count === 1 ? '' : 's'}</span></div></div>`;
  }).join('');
  return `<section class="files"><h3>Generated files</h3>${items}</section>`;
}

function renderFileReferenceHtml(file: { path: string; label: string; mime?: string; detail?: string }): string {
  const href = workspacePathToConversationHref(file.path);
  const isImage = isImageReference(file.path, file.mime);
  const preview = isImage && href
    ? `<a href="${escapeAttr(href)}"><img src="${escapeAttr(href)}" alt="${escapeAttr(file.label)}"></a>`
    : '';
  const link = href
    ? `<a href="${escapeAttr(href)}">${escapeHtml(file.label)}</a>`
    : `<span>${escapeHtml(file.label)}</span>`;
  return `<div class="file-ref">
    ${preview}
    <div><b>${link}</b><span>${escapeHtml(file.detail || file.path)}</span><code>${escapeHtml(file.path)}</code></div>
  </div>`;
}

function renderConversationMarkdown(thread: Thread, savedAt: string): string {
  const lines = [
    `# ${thread.title.trim() || 'Untitled conversation'}`,
    '',
    `- Thread ID: ${thread.id}`,
    `- Created: ${formatDate(thread.createdAt)}`,
    `- Updated: ${formatDate(thread.updatedAt)}`,
    `- Saved: ${savedAt}`,
    `- Messages: ${thread.messages.length}`,
    '',
  ];
  if (thread.summary?.trim()) lines.push('## Summary', '', thread.summary.trim(), '');
  if (thread.threadContext?.trim()) lines.push('## Context', '', thread.threadContext.trim(), '');
  lines.push('## Transcript', '', formatThreadPlainText(thread));
  return `${lines.join('\n')}\n`;
}

function formatThreadPlainText(thread: Thread): string {
  return thread.messages.map((message, index) => {
    const lines = [
      `#${index} ${message.role} ${message.id} ${formatDate(message.createdAt)}`,
      message.content.trim(),
    ];
    if (message.role === 'user' && message.attachments?.length) {
      lines.push('', 'Attachments:');
      lines.push(...message.attachments.map(attachment =>
        `- ${attachment.name} (${attachment.mime || 'file'}, ${formatBytes(attachment.size)}): ${attachment.path}`
      ));
    }
    if (message.role === 'assistant') {
      const assistant = message as AssistantMessage;
      const artifacts = assistant.toolResults?.flatMap(result => result.artifacts ?? []) ?? [];
      if (artifacts.length) {
        lines.push('', 'Generated files:');
        lines.push(...artifacts.map(artifact => {
          if (artifact.kind === 'image') return `- ${artifact.path} (${artifact.mime})`;
          return `- image job ${artifact.jobId} (${artifact.count} expected image${artifact.count === 1 ? '' : 's'})`;
        }));
      }
      if (assistant.toolCalls?.length) {
        lines.push('', 'Tool calls:', JSON.stringify(assistant.toolCalls, null, 2));
      }
      if (assistant.toolResults?.length) {
        lines.push('', 'Tool results:', JSON.stringify(assistant.toolResults, null, 2));
      }
    }
    return lines.join('\n');
  }).join('\n\n---\n\n');
}

function firstMessageSnippet(thread: Thread): string {
  const content = thread.messages.find(message => message.content.trim())?.content.trim() ?? '';
  return content.length > 220 ? `${content.slice(0, 220).trimEnd()}...` : content;
}

function workspacePathToConversationHref(path: string): string | null {
  const normalized = path.trim().replace(/\\/g, '/');
  if (!normalized.startsWith('/workspace/')) return null;
  return `../../${normalized.slice('/workspace/'.length).split('/').map(encodeURIComponent).join('/')}`;
}

function isImageReference(path: string, mime?: string): boolean {
  if (mime?.toLowerCase().startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(path);
}

function fileNameFromPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '');
  return normalized.split('/').pop() || path;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(ms: number): string {
  return new Date(ms).toISOString();
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function libraryStyle(): string {
  return `<style>
    :root {
      color-scheme: dark;
      --bg: #050608;
      --bg-2: #0a0c10;
      --panel: rgba(255,255,255,0.025);
      --panel-2: rgba(255,255,255,0.045);
      --text: #e4e7ef;
      --text-dim: #a0a9bd;
      --text-faint: #606778;
      --border: rgba(255,255,255,0.07);
      --border-strong: rgba(255,255,255,0.14);
      --accent: #3ecf8e;
      --accent-2: #5fe0a7;
      --accent-glow: rgba(62,207,142,0.35);
      --shadow-lift: 0 24px 60px -20px rgba(0,0,0,0.6), 0 8px 24px -12px rgba(0,0,0,0.4);
    }
    * { box-sizing: border-box; }
    *::selection { background: var(--accent-glow); color: var(--text); }
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.06); border-radius: 8px; }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.14); }
    html, body { margin: 0; padding: 0; }
    body {
      background: var(--bg);
      color: var(--text);
      font: 14.5px/1.6 'Geist', ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-feature-settings: 'ss01', 'cv11';
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }
    .bg-veil {
      position: fixed; inset: 0; pointer-events: none; z-index: 0;
      background:
        radial-gradient(ellipse 70% 50% at 12% -8%, rgba(62,207,142,0.07), transparent 60%),
        radial-gradient(ellipse 60% 50% at 92% 105%, rgba(62,207,142,0.035), transparent 60%);
    }
    a { color: var(--accent); text-decoration: none; transition: color .15s ease; }
    a:hover { color: var(--accent-2); }
    code { font-family: 'Geist Mono', ui-monospace, SFMono-Regular, monospace; }
    .sep { color: var(--text-faint); opacity: 0.7; }

    /* ─── SHELL ─── */
    .shell {
      position: relative; z-index: 1;
      width: min(960px, calc(100% - 40px));
      margin: 0 auto;
      padding: 36px 0 96px;
    }
    .conversation { width: min(760px, calc(100% - 40px)); }

    /* ─── PAGE HEAD (brand row) ─── */
    .page-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 20px;
      padding-bottom: 22px;
      margin-bottom: 56px;
      border-bottom: 1px solid var(--border);
    }
    .brand { display: inline-flex; align-items: baseline; gap: 7px; }
    .brand-link { color: var(--text); }
    .brand-link:hover .brand-name { color: var(--text); }
    .brand-name {
      font-family: 'Source Serif 4', Iowan Old Style, Georgia, serif;
      font-size: 19px; font-weight: 500;
      letter-spacing: -0.02em;
      color: var(--text);
      transition: color .15s ease;
    }
    .brand-dot {
      width: 5px; height: 5px; border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 8px var(--accent-glow);
      align-self: center; transform: translateY(-2px);
    }
    .page-head-meta {
      display: inline-flex; align-items: center; gap: 8px;
      color: var(--text-faint);
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 10.5px;
      letter-spacing: 0.04em;
    }

    /* ─── HERO ─── */
    .hero { margin-bottom: 64px; }
    .eyebrow {
      margin: 0 0 22px;
      color: var(--accent);
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 10.5px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.22em;
    }
    h1 {
      margin: 0;
      font-family: 'Source Serif 4', Iowan Old Style, Georgia, serif;
      font-weight: 400;
      font-style: italic;
      font-size: clamp(2.4rem, 5.5vw, 4rem);
      line-height: 1.02;
      letter-spacing: -0.025em;
      color: var(--text);
      max-width: 22ch;
    }
    .dek {
      max-width: 56ch;
      margin: 22px 0 0;
      color: var(--text-dim);
      font-size: 1rem;
      line-height: 1.6;
    }

    /* ─── THREAD META (conversation page) ─── */
    .thread-meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 0;
      margin: 36px 0 0;
      padding: 22px 0 0;
      border-top: 1px solid var(--border);
    }
    .thread-meta > div { min-width: 0; padding: 0 22px 0 0; }
    .thread-meta dt {
      margin: 0 0 6px;
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 9.5px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.18em;
      color: var(--text-faint);
    }
    .thread-meta dd {
      margin: 0;
      font-size: 13px;
      color: var(--text);
      overflow-wrap: anywhere;
    }
    .thread-meta dd code {
      font-size: 12px;
      color: var(--text-dim);
      letter-spacing: -0.005em;
    }
    .thread-meta time { font-family: 'Geist Mono', ui-monospace, monospace; font-size: 12px; color: var(--text-dim); }
    .saved-dot {
      display: inline-block;
      width: 5px; height: 5px; border-radius: 50%;
      background: var(--accent);
      box-shadow: 0 0 6px var(--accent-glow);
      margin-right: 6px;
      vertical-align: middle;
      animation: saved-pulse 2.4s ease-in-out infinite;
    }
    @keyframes saved-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }

    /* ─── TOPNAV (conversation page) ─── */
    .topnav { display: inline-flex; align-items: center; gap: 4px; }
    .topnav-link {
      display: inline-flex; align-items: center; gap: 6px;
      padding: 6px 10px;
      color: var(--text-dim);
      font-size: 12.5px;
      border-radius: 6px;
      transition: color .15s ease, background .15s ease;
    }
    .topnav-link:hover { color: var(--text); background: var(--panel); }
    .topnav-link.back { color: var(--accent); }
    .topnav-link.back:hover { color: var(--accent-2); background: var(--panel); }

    /* ─── TOOLBAR (library) ─── */
    .toolbar { margin: 0 0 40px; }
    .search-wrap { position: relative; display: flex; align-items: center; }
    .search-icon {
      position: absolute; left: 14px; pointer-events: none;
      color: var(--text-faint);
    }
    #search {
      width: 100%;
      height: 42px;
      padding: 0 48px 0 38px;
      background: transparent;
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font: 13.5px 'Geist', ui-sans-serif, system-ui, sans-serif;
      letter-spacing: -0.005em;
      outline: none;
      transition: border-color .15s ease, box-shadow .15s ease, background .15s ease;
    }
    #search::placeholder { color: var(--text-faint); }
    #search:focus {
      border-color: color-mix(in srgb, var(--accent) 55%, var(--border-strong));
      box-shadow: 0 0 0 3px rgba(62,207,142,0.10);
      background: var(--panel);
    }
    .kbd {
      position: absolute; right: 12px;
      display: inline-grid; place-items: center;
      width: 22px; height: 22px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 5px;
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 10.5px;
      color: var(--text-faint);
      pointer-events: none;
    }
    #search:focus + .kbd { opacity: 0.4; }

    /* ─── LIBRARY GROUPS ─── */
    .library { display: flex; flex-direction: column; gap: 44px; }
    .library.hidden { display: none; }
    .group { display: flex; flex-direction: column; gap: 4px; }
    .group-head {
      display: flex; align-items: center; gap: 12px;
      margin-bottom: 14px;
    }
    .group-label {
      flex: none;
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: var(--text-faint);
    }
    .group-rule { flex: 1; height: 1px; background: var(--border); }
    .group-count {
      flex: none;
      padding: 1px 8px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 100px;
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 10px;
      color: var(--text-faint);
    }
    .entries { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
    .entry {
      position: relative;
      display: flex; align-items: stretch;
      border-bottom: 1px solid var(--border);
    }
    .entry:first-child { border-top: 1px solid var(--border); }
    .entry-link {
      flex: 1; min-width: 0;
      display: flex; align-items: center; gap: 16px;
      padding: 22px 8px 22px 4px;
      color: inherit;
      transition: background .15s ease, padding .15s ease;
      border-radius: 4px;
    }
    .entry-link:hover { background: var(--panel); padding-left: 12px; padding-right: 12px; }
    .entry-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
    .entry-title {
      margin: 0;
      font-family: 'Source Serif 4', Iowan Old Style, Georgia, serif;
      font-weight: 500;
      font-size: 1.25rem;
      line-height: 1.25;
      letter-spacing: -0.015em;
      color: var(--text);
      transition: color .15s ease;
    }
    .entry-link:hover .entry-title { color: var(--text); }
    .entry-summary {
      margin: 0;
      font-family: 'Source Serif 4', Iowan Old Style, Georgia, serif;
      font-size: 14.5px;
      line-height: 1.5;
      color: var(--text-dim);
      font-style: italic;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .entry-meta {
      display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
      margin-top: 4px;
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 10.5px;
      color: var(--text-faint);
      letter-spacing: 0.02em;
    }
    .entry-meta code {
      color: var(--text-faint);
      max-width: 22ch;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .entry-chev {
      flex: none;
      color: var(--text-faint);
      font-size: 18px;
      font-family: 'Geist', sans-serif;
      align-self: center;
      transition: color .15s ease, transform .2s ease;
    }
    .entry-link:hover .entry-chev { color: var(--accent); transform: translateX(4px); }
    .entry-md {
      flex: none;
      display: inline-grid; place-items: center;
      width: 32px;
      align-self: stretch;
      margin: 8px 0;
      color: var(--text-faint);
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 10.5px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      border-left: 1px solid var(--border);
      transition: color .15s ease, background .15s ease;
    }
    .entry-md:hover { color: var(--accent); background: var(--panel); }

    /* ─── NOTES (summary / context blocks) ─── */
    .note {
      padding: 18px 22px;
      margin: 0 0 18px;
      border-left: 2px solid var(--accent);
      background: var(--panel);
      border-radius: 0 6px 6px 0;
    }
    .note h2 {
      margin: 0 0 8px;
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: var(--accent);
    }
    .note p {
      margin: 0;
      font-family: 'Source Serif 4', Iowan Old Style, Georgia, serif;
      font-size: 15px;
      line-height: 1.6;
      color: var(--text-dim);
    }

    /* ─── TRANSCRIPT ─── */
    .transcript {
      display: flex; flex-direction: column;
      margin: 56px 0 40px;
      border-top: 1px solid var(--border);
    }
    .message {
      padding: 30px 0;
      border-bottom: 1px solid var(--border);
    }
    .message:last-child { border-bottom: none; }
    .message-kicker {
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 14px;
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 10px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.16em;
    }
    .message--user .message-kicker .role { color: var(--text-faint); }
    .message--assistant .message-kicker .role { color: var(--accent); }
    .message-kicker time { color: var(--text-faint); letter-spacing: 0.06em; }
    .message-content pre {
      margin: 0;
      font-family: 'Source Serif 4', Iowan Old Style, Georgia, serif;
      font-size: 16px;
      line-height: 1.65;
      color: var(--text);
      letter-spacing: -0.005em;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .message--user .message-content pre { color: var(--text); }

    /* ─── FILES ─── */
    .files {
      margin-top: 18px;
      padding-top: 14px;
      border-top: 1px dashed var(--border);
      display: flex; flex-direction: column; gap: 10px;
    }
    .files h3 {
      margin: 0 0 2px;
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 9.5px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.2em;
      color: var(--text-faint);
    }
    .file-ref {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 14px;
      align-items: center;
      padding: 12px 14px;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 8px;
      min-width: 0;
      transition: border-color .15s ease, background .15s ease;
    }
    .file-ref:hover { border-color: var(--border-strong); background: var(--panel-2); }
    .file-ref img {
      display: block;
      width: 96px; height: 72px;
      object-fit: cover;
      border-radius: 5px;
      border: 1px solid var(--border);
      background: var(--bg-2);
    }
    .file-ref b, .file-ref span, .file-ref code {
      display: block; min-width: 0; overflow-wrap: anywhere;
    }
    .file-ref b { font-size: 13px; font-weight: 500; color: var(--text); margin-bottom: 2px; }
    .file-ref b a { color: var(--accent); }
    .file-ref > div > span { color: var(--text-dim); font-size: 12px; }
    .file-ref code {
      margin-top: 3px;
      font-size: 10.5px;
      color: var(--text-faint);
    }

    /* ─── DETAILS (tool calls/results inside messages) ─── */
    .message details { margin-top: 12px; }
    .message details > summary {
      cursor: pointer;
      list-style: none;
      padding: 6px 0;
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 10.5px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--text-faint);
      transition: color .15s ease;
    }
    .message details > summary:hover { color: var(--text-dim); }
    .message details > summary::-webkit-details-marker { display: none; }
    .message details > summary::before { content: '▸ '; display: inline-block; transition: transform .15s ease; color: var(--text-faint); }
    .message details[open] > summary::before { transform: rotate(90deg); }
    .message details pre {
      margin-top: 10px;
      padding: 12px 14px;
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 6px;
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 11.5px;
      line-height: 1.55;
      color: var(--text-dim);
      max-height: 360px;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    /* ─── RAW BLOCK ─── */
    .raw-block { margin-top: 32px; }
    .raw-block details > summary {
      cursor: pointer;
      list-style: none;
      padding: 14px 0;
      border-top: 1px solid var(--border);
      border-bottom: 1px solid var(--border);
    }
    .raw-block details > summary::-webkit-details-marker { display: none; }
    .raw-summary { display: flex; align-items: center; gap: 12px; }
    .raw-summary::before {
      content: '+';
      width: 18px; height: 18px;
      display: inline-grid; place-items: center;
      color: var(--text-faint);
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 14px;
      transition: transform .2s ease;
    }
    .raw-block details[open] .raw-summary::before { content: '−'; }
    .raw-title {
      font-family: 'Source Serif 4', Iowan Old Style, Georgia, serif;
      font-size: 15px;
      font-weight: 500;
      color: var(--text);
      letter-spacing: -0.01em;
    }
    .raw-hint {
      margin-left: auto;
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.16em;
      color: var(--text-faint);
    }
    .raw-block pre {
      margin: 20px 0 0;
      padding: 18px 20px;
      background: var(--bg-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      max-height: 520px;
      overflow: auto;
      font: 11.5px/1.7 'Geist Mono', ui-monospace, monospace;
      color: var(--text-dim);
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    /* ─── EMPTY / FOOTER ─── */
    .empty {
      padding: 80px 24px;
      text-align: center;
      color: var(--text-faint);
      font-family: 'Source Serif 4', Iowan Old Style, Georgia, serif;
      font-size: 16px;
      font-style: italic;
    }
    .empty.hidden { display: none; }
    .page-foot {
      display: flex; justify-content: center; align-items: center;
      gap: 10px;
      margin-top: 96px;
      padding-top: 28px;
      border-top: 1px solid var(--border);
      color: var(--text-faint);
      font-family: 'Geist Mono', ui-monospace, monospace;
      font-size: 10.5px;
      letter-spacing: 0.04em;
    }
    .page-foot code { color: var(--text-faint); }
    .foot-link { color: var(--text-faint); }
    .foot-link:hover { color: var(--accent); }

    /* ─── RESPONSIVE ─── */
    @media (max-width: 720px) {
      .shell { padding: 28px 0 64px; }
      .conversation { width: min(100% - 28px, 760px); }
      .page-head { margin-bottom: 36px; }
      .hero { margin-bottom: 40px; }
      h1 { font-size: clamp(2rem, 9vw, 2.75rem); }
      .thread-meta { grid-template-columns: 1fr 1fr; gap: 18px 0; }
      .entry-link { padding: 18px 4px; gap: 12px; }
      .entry-link:hover { padding-left: 8px; padding-right: 8px; }
      .entry-title { font-size: 1.05rem; }
      .entry-summary { font-size: 13.5px; }
      .entry-md { width: 28px; }
      .transcript { margin: 36px 0 28px; }
      .message { padding: 24px 0; }
      .message-content pre { font-size: 15px; }
      .file-ref { grid-template-columns: 1fr; }
      .file-ref img { width: 100%; height: auto; max-height: 240px; }
      .page-head-meta { display: none; }
    }
  </style>`;
}
