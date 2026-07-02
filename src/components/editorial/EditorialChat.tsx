// The main chat view: the (windowed) message list, the composer, and the
// empty/first-run state. Rendered by the app shell; reads RootStore via hooks.
// Invariant: persisted chat state stays in stores; this surface is presentation only.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { autorun } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useChatStore, useModelRegistry, useProviderStore, useRouterStore, useUiStore } from '../../stores/context';
import { isWebLite } from '../../core/runtime';
import { clientPlatform } from '../../core/clientPlatform';
import { recommendedDownload } from '../../core/downloads';
import { EditorialMessage } from './EditorialMessage';
import { EditorialComposer } from './EditorialComposer';

const STICKY_BOTTOM_PX = 100;
const INITIAL_RENDERED_MESSAGES = 120;
const RENDERED_MESSAGE_PAGE_SIZE = 80;

/**
 * First-run / empty-thread panel. Replaces the previous cryptic "A blank page"
 * line with something a first-time visitor can act on: a one-line description,
 * a clear "add your key" call-to-action when no provider is usable yet, and a
 * Web Lite note that conversations live in this browser.
 */
const ChatEmptyState = observer(function ChatEmptyState() {
  const router = useRouterStore();
  const providers = useProviderStore();
  const chat = useChatStore();
  const needsKey = !providers.hasUsableProvider;
  const webLite = isWebLite();
  const hasMessages = (chat.activeThread?.messages.length ?? 0) > 0;
  const hasModel = Boolean(chat.activeThread?.modelId);

  const checklist = [
    { done: !needsKey, label: 'Connect OpenRouter in Models' },
    { done: hasModel, label: 'Pick a model from the composer' },
    { done: hasMessages, label: 'Send your first message' },
  ];

  return (
    <div className="editorial-empty-state">
      <div className="editorial-empty-state__eyebrow">Local-first AI workspace</div>
      <h1 className="editorial-empty-state__title">GatesAI Chat</h1>
      <p className="editorial-empty-state__lede">
        {webLite
          ? 'Chat with frontier models from this browser. Move to desktop when you want local files, tools, and image generation in the same workspace.'
          : 'Chat with frontier models, run tools over local files, and generate images in one quiet workspace.'}
      </p>

      {needsKey ? (
        <button
          type="button"
          className="editorial-empty-state__primary"
          onClick={() => router.goMenu('models')}
        >
          Add your OpenRouter key in Models
        </button>
      ) : (
        <div className="editorial-empty-state__ready">
          Type a message below to begin.
        </div>
      )}

      <ul className="editorial-empty-state__checklist" aria-label="Setup checklist">
        {checklist.map(item => (
          <li key={item.label} data-done={item.done || undefined}>
            <span aria-hidden="true" className="editorial-empty-state__check">
              {item.done ? '✓' : '○'}
            </span>
            <span>{item.label}</span>
          </li>
        ))}
      </ul>

      {webLite && (
        <div className="editorial-empty-state__local-note">
          Your conversations are saved locally in this browser.
        </div>
      )}

    </div>
  );
});

/**
 * Web Lite → desktop upsell. Web Lite can't touch local files, run tools, or
 * generate images; the desktop app can. We recommend the build that matches the
 * visitor's detected platform (the x64 Windows installer for Windows users) and
 * fall back to the GitHub repo for everything we don't ship a binary for, always
 * stating what the download runs on.
 */
function WebLiteDownloadCue() {
  const { os, arch } = clientPlatform();
  const rec = recommendedDownload(os, arch);
  const isSource = rec.kind === 'source';
  // Self-dismiss once the fade-out completes so the toast never lingers — an
  // invisible fixed element would keep covering the composer. The timer is a
  // fallback for environments that suppress CSS animations (prefers-reduced-
  // motion), where `animationend` may never fire.
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDismissed(true), 11_000);
    return () => clearTimeout(timer);
  }, []);
  if (dismissed) return null;
  return (
    <div
      className="web-lite-download-cue"
      onAnimationEnd={event => {
        if (event.target === event.currentTarget) setDismissed(true);
      }}
    >
      <div className="web-lite-download-cue__copy">
        Want local files, tools, and image generation? Get the desktop app.
      </div>
      <a
        href={rec.url}
        target="_blank"
        rel="noopener noreferrer"
        className="web-lite-download-cue__link"
      >
        {isSource ? 'Get it on GitHub' : rec.label}
      </a>
      <div className="web-lite-download-cue__meta">
        {rec.runsOn}
        {!isSource && ' · other platforms on GitHub'}
      </div>
      {rec.note && (
        <div className="web-lite-download-cue__meta">
          {rec.note}
        </div>
      )}
    </div>
  );
}

export const EditorialChat = observer(function EditorialChat() {
  const chat = useChatStore();
  const router = useRouterStore();
  const registry = useModelRegistry();
  const ui = useUiStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const lastMessageCountRef = useRef(0);
  const previousStreamingIdRef = useRef<string | null>(null);
  const prependScrollHeightRef = useRef<number | null>(null);
  // Sticky-bottom: only auto-scroll when the user is parked near the bottom.
  // If they've scrolled up to read history we leave them there. Updated by a
  // rAF-throttled scroll listener so we're not measuring layout per token.
  const stickyRef = useRef(true);

  const activeThread = chat.activeThread;
  const activeThreadId = activeThread?.id ?? null;
  const messages = useMemo(() => activeThread?.messages ?? [], [activeThread?.messages]);
  const streamingId = chat.streamingMessageId;
  const messageCount = messages.length;
  const activeThreadStreaming = activeThreadId ? chat.isThreadStreaming(activeThreadId) : false;
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDERED_MESSAGES);
  const hiddenMessageCount = Math.max(0, messageCount - renderLimit);
  const visibleMessages = hiddenMessageCount > 0 ? messages.slice(hiddenMessageCount) : messages;

  const scheduleScrollToBottom = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  const goResultThread = useCallback((threadId: string | null) => {
    if (!threadId) return;
    router.goThread(threadId);
  }, [router]);
  const regenerateMessage = useCallback((messageId: string) => {
    if (!activeThreadId) return;
    goResultThread(chat.regenerateFromMessage(activeThreadId, messageId));
  }, [activeThreadId, chat, goResultThread]);
  const branchMessage = useCallback((messageId: string) => {
    if (!activeThreadId) return;
    goResultThread(chat.branchThreadFromMessage(activeThreadId, messageId));
  }, [activeThreadId, chat, goResultThread]);
  const editAndResendMessage = useCallback((messageId: string, text: string) => {
    if (!activeThreadId) return;
    goResultThread(chat.editAndResendFromMessage(activeThreadId, messageId, text));
  }, [activeThreadId, chat, goResultThread]);

  useEffect(() => () => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  useEffect(() => {
    ui.setComposerFocusHandler(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      const end = textarea.value.length;
      textarea.setSelectionRange(end, end);
    });
    return () => ui.setComposerFocusHandler(null);
  }, [ui]);

  useEffect(() => {
    setRenderLimit(INITIAL_RENDERED_MESSAGES);
  }, [activeThreadId]);

  // Watch scroll position. Anything within STICKY_BOTTOM_PX of bottom counts
  // as "at bottom" — covers small offsets from images loading or trailing
  // whitespace. We measure synchronously in the passive scroll listener so a
  // user scrolling up during streaming wins the race against the next token's
  // sync `scrollTop = scrollHeight` write — if we deferred to rAF, the
  // streaming effect could land first and re-pin them to the bottom. The
  // single read of layout properties here is cheap; passive listeners can't
  // block scrolling anyway.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyRef.current = distance <= STICKY_BOTTOM_PX;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Thread switch: always reset to bottom and re-arm sticky.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    scheduleScrollToBottom();
    stickyRef.current = true;
  }, [activeThread?.id, scheduleScrollToBottom]);

  // New user message: force-scroll so the just-sent turn is visible even if
  // the user was reading earlier history. Other new messages keep sticky
  // behavior so background arrivals do not yank the scroll position.
  useEffect(() => {
    const previousCount = lastMessageCountRef.current;
    lastMessageCountRef.current = messageCount;
    if (messageCount <= previousCount) return;
    const lastMessage = messages[messageCount - 1];
    if (lastMessage?.role === 'user') {
      stickyRef.current = true;
      scheduleScrollToBottom();
      return;
    }
    if (stickyRef.current) scheduleScrollToBottom();
  }, [messageCount, messages, scheduleScrollToBottom]);

  useEffect(() => {
    const dispose = autorun(() => {
      const id = chat.streamingMessageId;
      if (!id) return;
      const content = chat.activeThread?.messages.find(m => m.id === id)?.content ?? '';
      if (!content || !stickyRef.current) return;
      scheduleScrollToBottom();
    });
    return () => dispose();
  }, [chat, scheduleScrollToBottom]);

  useLayoutEffect(() => {
    const previousHeight = prependScrollHeightRef.current;
    prependScrollHeightRef.current = null;
    const el = scrollRef.current;
    if (!el || previousHeight == null) return;
    el.scrollTop += el.scrollHeight - previousHeight;
  }, [hiddenMessageCount]);

  // Response finished: force-scroll once to reveal the final answer tail.
  useEffect(() => {
    const previous = previousStreamingIdRef.current;
    previousStreamingIdRef.current = streamingId;
    if (previous && !streamingId) {
      stickyRef.current = true;
      scheduleScrollToBottom();
    }
  }, [streamingId, scheduleScrollToBottom]);

  return (
    <div className="editorial-chat-shell" style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      minWidth: 0, background: 'var(--bg)', position: 'relative',
    }}>
      <div ref={scrollRef} className="editorial-chat-scroll" style={{ flex: 1, overflowY: 'auto', padding: '36px 48px 8px' }}>
        <div style={{ width: 'min(var(--reading-width, 720px), 70%)', margin: '0 auto' }} className="editorial-stream">
          {messages.length === 0 && <ChatEmptyState />}
          {hiddenMessageCount > 0 && (
            <button
              type="button"
              className="editorial-show-earlier"
              onClick={() => {
                const el = scrollRef.current;
                prependScrollHeightRef.current = el?.scrollHeight ?? null;
                setRenderLimit(limit => limit + RENDERED_MESSAGE_PAGE_SIZE);
              }}
            >
              Show {Math.min(RENDERED_MESSAGE_PAGE_SIZE, hiddenMessageCount)} earlier messages
            </button>
          )}
          {visibleMessages.map(m => {
            const modelId = m.role === 'assistant' ? m.model : undefined;
            return (
              <EditorialMessage
                key={m.id}
                message={m}
                modelName={modelId ? (registry.findById(modelId)?.name ?? modelId) : undefined}
                streaming={m.id === chat.streamingMessageId}
                actionsDisabled={activeThreadStreaming}
                onRegenerate={regenerateMessage}
                onBranch={branchMessage}
                onEditAndResend={editAndResendMessage}
              />
            );
          })}
        </div>
      </div>
      {isWebLite() && messages.length === 0 && <WebLiteDownloadCue />}
      <EditorialComposer textareaRef={textareaRef} />
    </div>
  );
});
