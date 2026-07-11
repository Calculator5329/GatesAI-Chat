// The main chat view: the (windowed) message list, the composer, and the
// empty/first-run state. Rendered by the app shell; reads RootStore via hooks.
// Invariant: persisted chat state stays in stores; this surface is presentation only.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { autorun } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEditorial } from '../../stores/context';
import { isTauri, isWebLite } from '../../core/runtime';
import { clientPlatform } from '../../core/clientPlatform';
import { recommendedDownload } from '../../core/downloads';
import type { Message, Model } from '../../core/types';
import { SecretKeyField } from '../ui';
import { EditorialMessage } from './EditorialMessage';
import { EditorialComposer } from './EditorialComposer';
import {
  computeVisibleMessageRange,
  edgeRenderedMessageIds,
  hasMessageWindowingSupport,
  nextMeasuredMessageHeights,
  placeholderHeightForMessage,
  shouldRenderFullMessage,
  streamingNeighborMessageIds,
} from './messageWindowing';

const STICKY_BOTTOM_PX = 100;
const INITIAL_RENDERED_MESSAGES = 120;
const RENDERED_MESSAGE_PAGE_SIZE = 80;
const MESSAGE_PLACEHOLDER_STYLE: CSSProperties = {
  borderBottom: '1px solid var(--border)',
  boxSizing: 'border-box',
  pointerEvents: 'none',
};

/**
 * First-run / empty-thread panel. Replaces the previous cryptic "A blank page"
 * line with something a first-time visitor can act on: a one-line description,
 * a clear "add your key" call-to-action when no provider is usable yet, and a
 * Web Lite note that conversations live in this browser.
 */
const ChatEmptyState = observer(function ChatEmptyState() {
  const { chat, providers, registry, ui, ollama } = useEditorial();
  const webLite = isWebLite();
  const hasMessages = (chat.activeThread?.messages.length ?? 0) > 0;
  const hasPriorMessages = chat.threads.some(thread => thread.messages.length > 0);
  const activeModel = registry.findById(chat.activeThread?.modelId ?? '');
  const activeProviderReady = activeModel
    ? providers.isConnected(activeModel.providerId)
    : providers.hasUsableProvider;
  const [readyMessage, setReadyMessage] = useState<string | null>(null);

  useEffect(() => {
    if (hasPriorMessages && !ui.onboardingDismissed) ui.setOnboardingDismissed(true);
  }, [hasPriorMessages, ui]);

  const showOnboarding =
    !ui.onboardingDismissed
    && !activeProviderReady
    && !hasPriorMessages
    && !hasMessages;

  const normalMessage = readyMessage
    ?? (activeProviderReady
      ? 'A blank thread is ready; write below when you want to begin.'
      : 'A blank thread is waiting; connect a cloud or local model when you are ready.');

  return (
    <div className="editorial-empty-state">
      <div className="editorial-empty-state__eyebrow">Local-first AI workspace</div>
      <h1 className="editorial-empty-state__title">GatesAI Chat</h1>
      <p className="editorial-empty-state__lede">
        {webLite
          ? 'Chat with frontier models from this browser. Move to desktop when you want local files, tools, and image generation in the same workspace.'
          : 'Chat with frontier models, run tools over local files, and generate images in one quiet workspace.'}
      </p>

      {showOnboarding ? (
        <FirstRunOnboardingPanel onReady={setReadyMessage} />
      ) : (
        <>
          <div className="editorial-empty-state__ready">
            {normalMessage}
          </div>
          {!webLite && activeModel?.providerId === 'ollama' && !ollama.hasModelTag('nomic-embed-text') && (
            <SemanticMemoryNudge />
          )}
        </>
      )}

      {webLite && (
        <div className="editorial-empty-state__local-note">
          Your conversations are saved locally in this browser.
        </div>
      )}

    </div>
  );
});

const SemanticMemoryNudge = observer(function SemanticMemoryNudge() {
  const { ollama } = useEditorial();
  const [dismissed, setDismissed] = useState(false);
  const model = 'nomic-embed-text';
  const state = ollama.pulls.get(model);
  if (dismissed || ollama.hasModelTag(model)) return null;
  return (
    <div style={{
      margin: '12px auto 0',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      color: 'var(--text-faint)',
      fontSize: 12,
      flexWrap: 'wrap',
    }}>
      <span>Optional: add semantic memory</span>
      {ollama.isPulling(model) ? (
        <>
          <span>{state?.phase ?? 'Pulling'} · {Math.round(state?.percent ?? 0)}%</span>
          <button type="button" className="editorial-empty-state__secondary" onClick={() => ollama.cancelPull(model)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className="editorial-empty-state__secondary" onClick={() => { void ollama.startPull(model); }}>
          Pull nomic-embed-text
        </button>
      )}
      <button type="button" className="editorial-empty-state__secondary" onClick={() => setDismissed(true)}>
        Dismiss
      </button>
      {state?.error && <span role="alert" style={{ color: 'var(--danger)' }}>{state.error}</span>}
    </div>
  );
});

const FirstRunOnboardingPanel = observer(function FirstRunOnboardingPanel({
  onReady,
}: {
  onReady: (message: string) => void;
}) {
  const { chat, providers, registry, localRuntime, ui, openrouter, ollama } = useEditorial();
  const webLite = isWebLite();
  const [cloudState, setCloudState] = useState<'idle' | 'checking' | 'error'>('idle');
  const [cloudMessage, setCloudMessage] = useState<string | null>(null);
  const [localChecking, setLocalChecking] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (webLite || !isTauri()) return;
    localRuntime.refreshAll();
  }, [localRuntime, webLite]);

  const validateOpenRouterKey = useCallback(async (key: string) => {
    if (cloudState === 'checking') return;
    setCloudState('checking');
    setCloudMessage('Checking OpenRouter...');
    await openrouter.refresh(key);
    if (openrouter.fetchError) {
      setCloudState('error');
      setCloudMessage(formatOpenRouterKeyError(openrouter.fetchError));
      return;
    }
    providers.setKey('openrouter', key);
    const message = `Key works - ${formatModelCount(openrouter.count)} available.`;
    onReady(message);
    setCloudState('idle');
    setCloudMessage(message);
    ui.setOnboardingDismissed(true);
    ui.focusComposer();
  }, [cloudState, onReady, openrouter, providers, ui]);

  const refreshLocal = useCallback(async () => {
    if (localChecking) return;
    setLocalChecking(true);
    setLocalError(null);
    try {
      if (!localRuntime.autoDetectComplete && !localRuntime.runtimes.ollama.installPath) {
        await localRuntime.autoDetect();
      }
      await localRuntime.refreshStatus('ollama');
      if (localRuntime.runtimes.ollama.status === 'online') {
        await ollama.refresh();
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocalChecking(false);
    }
  }, [localChecking, localRuntime, ollama]);

  const localModels = registry.all.filter(model => model.providerId === 'ollama');
  const selectLocalModel = useCallback(() => {
    const threadId = chat.activeThreadId;
    const model = bestLocalModel(localModels);
    if (!threadId || !model) return;
    chat.setThreadModel(threadId, model.id);
    const message = `Ollama detected - ${formatModelCount(localModels.length)} ready.`;
    onReady(message);
    ui.setOnboardingDismissed(true);
    ui.focusComposer();
  }, [chat, localModels, onReady, ui]);

  const startStarterPull = useCallback(async () => {
    const ok = await ollama.startPull('llama3.2:3b');
    if (!ok) return;
    const threadId = chat.activeThreadId;
    const model = registry.all.find(item => item.providerId === 'ollama' && item.providerModelId === 'llama3.2:3b')
      ?? bestLocalModel(registry.all.filter(item => item.providerId === 'ollama'));
    if (!threadId || !model) return;
    chat.setThreadModel(threadId, model.id);
    const message = `Ollama detected - ${model.name} ready.`;
    onReady(message);
    ui.setOnboardingDismissed(true);
    ui.focusComposer();
  }, [chat, ollama, onReady, registry, ui]);

  const dismiss = useCallback(() => {
    ui.setOnboardingDismissed(true);
  }, [ui]);

  return (
    <div className="editorial-onboarding" aria-label="Choose how to start chatting">
      <section className="editorial-onboarding__card">
        <div className="editorial-onboarding__kicker">Cloud</div>
        <h2>Use cloud models</h2>
        <p>
          Paste an OpenRouter API key. OpenRouter requires a key for every route, including free models.
        </p>
        <SecretKeyField
          value={providers.getConfig('openrouter').apiKey ?? ''}
          onSet={validateOpenRouterKey}
          onClear={() => providers.remove('openrouter')}
          placeholder="Paste your OpenRouter API key..."
          getKeyUrl="https://openrouter.ai/keys"
          connectLabel={cloudState === 'checking' ? 'Checking...' : 'Connect'}
          submitOnPaste
        />
        {cloudMessage && (
          <div
            className="editorial-onboarding__status"
            data-tone={cloudState === 'error' ? 'error' : 'ok'}
            role={cloudState === 'error' ? 'alert' : 'status'}
          >
            {cloudMessage}
          </div>
        )}
      </section>

      {!webLite && (
        <OllamaOnboardingCard
          models={localModels}
          checking={localChecking || ollama.fetching || localRuntime.autoDetecting}
          error={localError ?? ollama.lastError ?? null}
          onRefresh={refreshLocal}
          onSelect={selectLocalModel}
          onStarterPull={startStarterPull}
        />
      )}

      <section className="editorial-onboarding__card editorial-onboarding__card--muted">
        <div className="editorial-onboarding__kicker">Explore</div>
        <h2>Just look around</h2>
        <p>
          Hide this setup panel and keep the normal empty chat surface. You can connect a provider later.
        </p>
        <button type="button" className="editorial-empty-state__primary" onClick={dismiss}>
          Look around
        </button>
      </section>
    </div>
  );
});

const OllamaOnboardingCard = observer(function OllamaOnboardingCard({
  models,
  checking,
  error,
  onRefresh,
  onSelect,
  onStarterPull,
}: {
  models: Model[];
  checking: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelect: () => void;
  onStarterPull: () => void;
}) {
  const { bridge, localRuntime, ollama } = useEditorial();
  const runtime = localRuntime.runtimes.ollama;
  const online = runtime.status === 'online';
  const ready = online && models.length > 0;
  const notDetected = !runtime.installPath && runtime.status !== 'online';
  const buttonLabel = checking ? 'Checking...' : 'Check again';
  const starter = 'llama3.2:3b';
  const starterState = ollama.pulls.get(starter);

  return (
    <section className="editorial-onboarding__card">
      <div className="editorial-onboarding__kicker">Local</div>
      <h2>Use local models</h2>
      {ready ? (
        <>
          <p>Ollama detected - {formatModelCount(models.length)} ready.</p>
          <button type="button" className="editorial-empty-state__primary" onClick={onSelect}>
            Use {bestLocalModel(models)?.name ?? 'local model'}
          </button>
        </>
      ) : online ? (
        <>
          <p>Ollama is running, but no chat models are pulled yet.</p>
          <button
            type="button"
            className="editorial-empty-state__primary"
            onClick={onStarterPull}
            disabled={checking || ollama.isPulling(starter)}
          >
            {ollama.isPulling(starter) ? `Pulling ${Math.round(starterState?.percent ?? 0)}%` : 'Get a starter model'}
          </button>
          {starterState && (
            <div
              className="editorial-onboarding__status"
              data-tone={starterState.error ? 'error' : 'ok'}
              role={starterState.error ? 'alert' : 'status'}
            >
              {starterState.error ? starterState.error : `${starterState.phase} · ${Math.round(starterState.percent)}%`}
            </div>
          )}
        </>
      ) : notDetected ? (
        <>
          <p>
            Ollama is not detected. Install it from{' '}
            <a
              href="https://ollama.com"
              target="_blank"
              rel="noreferrer"
              onClick={event => {
                if (!isTauri()) return;
                event.preventDefault();
                void bridge.openExternalTarget('https://ollama.com');
              }}
            >
              ollama.com
            </a>
            , then check again.
          </p>
          <button type="button" className="editorial-empty-state__primary" onClick={onRefresh} disabled={checking}>
            {buttonLabel}
          </button>
        </>
      ) : (
        <>
          <p>Start Ollama, then check again. If no models appear, run <code>ollama pull llama3.1</code>.</p>
          <button type="button" className="editorial-empty-state__primary" onClick={onRefresh} disabled={checking}>
            {buttonLabel}
          </button>
        </>
      )}
      {error && (
        <div className="editorial-onboarding__status" data-tone="error" role="alert">
          {error}
        </div>
      )}
    </section>
  );
});

function formatOpenRouterKeyError(error: string): string {
  if (/\b(401|403)\b/.test(error)) {
    return 'OpenRouter rejected this key. Check the key and paste it again.';
  }
  return `Could not validate the key: ${error}`;
}

function formatModelCount(count: number): string {
  return `${count} model${count === 1 ? '' : 's'}`;
}

function bestLocalModel(models: Model[]): Model | undefined {
  return models.find(model => model.supportsTools !== false) ?? models[0];
}

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
  // fallback for environments that suppress CSS transitions.
  const [dismissed, setDismissed] = useState(false);
  const [visible, setVisible] = useState(false);
  const [leaving, setLeaving] = useState(false);
  useEffect(() => {
    const show = requestAnimationFrame(() => setVisible(true));
    const leave = setTimeout(() => setLeaving(true), 10_840);
    const dismiss = setTimeout(() => setDismissed(true), 11_000);
    return () => {
      cancelAnimationFrame(show);
      clearTimeout(leave);
      clearTimeout(dismiss);
    };
  }, []);
  if (dismissed) return null;
  return (
    <div
      className="web-lite-download-cue"
      data-visible={visible || undefined}
      data-leaving={leaving || undefined}
      onTransitionEnd={event => {
        if (leaving && event.target === event.currentTarget) setDismissed(true);
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
  const { chat, registry, router, ui } = useEditorial();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const lastMessageCountRef = useRef(0);
  const previousStreamingIdRef = useRef<string | null>(null);
  const prependScrollHeightRef = useRef<number | null>(null);
  const measuredMessageHeightsRef = useRef<ReadonlyMap<string, number>>(new Map());
  // Sticky-bottom: only auto-scroll when the user is parked near the bottom.
  // If they've scrolled up to read history we leave them there. Updated by a
  // rAF-throttled scroll listener so we're not measuring layout per token.
  const stickyRef = useRef(true);
  const windowingSupported = hasMessageWindowingSupport();
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  const [, setHeightVersion] = useState(0);

  const activeThread = chat.activeThread;
  const activeThreadId = activeThread?.id ?? null;
  const messages = useMemo(() => activeThread?.messages ?? [], [activeThread?.messages]);
  const streamingId = chat.streamingMessageId;
  const messageCount = messages.length;
  const activeThreadStreaming = activeThreadId ? chat.isThreadStreaming(activeThreadId) : false;
  const activeThreadHydrating = activeThreadId ? chat.isThreadHydrating(activeThreadId) : false;
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDERED_MESSAGES);
  const hiddenMessageCount = Math.max(0, messageCount - renderLimit);
  const visibleMessages = hiddenMessageCount > 0 ? messages.slice(hiddenMessageCount) : messages;
  const visibleMessageIds = visibleMessages.map(message => message.id);
  const edgeRenderedIds = edgeRenderedMessageIds(visibleMessageIds);
  const streamingNeighborIds = streamingNeighborMessageIds(visibleMessageIds, streamingId);
  const visibleRange = computeVisibleMessageRange({
    messageIds: visibleMessageIds,
    heights: measuredMessageHeightsRef.current,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
  });

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
    chat.selectThread(threadId);
    router.goThread(threadId);
  }, [chat, router]);
  const regenerateMessage = useCallback((messageId: string) => {
    if (!activeThreadId) return;
    goResultThread(chat.regenerate(activeThreadId, messageId));
  }, [activeThreadId, chat, goResultThread]);
  const branchMessage = useCallback((messageId: string) => {
    if (!activeThreadId) return;
    goResultThread(chat.branchFrom(activeThreadId, messageId));
  }, [activeThreadId, chat, goResultThread]);
  const editAndResendMessage = useCallback((messageId: string, text: string) => {
    if (!activeThreadId) return;
    goResultThread(chat.editAndResend(activeThreadId, messageId, text));
  }, [activeThreadId, chat, goResultThread]);

  useEffect(() => () => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  const recordMessageHeight = useCallback((messageId: string, height: number) => {
    const previous = measuredMessageHeightsRef.current;
    const next = nextMeasuredMessageHeights(
      measuredMessageHeightsRef.current,
      messageId,
      height,
    );
    if (next === previous) return;
    measuredMessageHeightsRef.current = next;
    setHeightVersion(version => version + 1);
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
      setViewport(previous => (
        previous.scrollTop === el.scrollTop && previous.height === el.clientHeight
          ? previous
          : { scrollTop: el.scrollTop, height: el.clientHeight }
      ));
    };
    onScroll();
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
          {activeThreadHydrating && (
            <div className="editorial-empty-state" role="status">
              <div className="editorial-empty-state__ready">Loading conversation...</div>
            </div>
          )}
          {!activeThreadHydrating && messages.length === 0 && <ChatEmptyState />}
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
          {visibleMessages.map((m, index) => {
            const modelId = m.role === 'assistant' ? m.model : undefined;
            const originalIndex = hiddenMessageCount + index;
            const renderBody = shouldRenderFullMessage({
              windowingSupported,
              nearViewport: index >= visibleRange.start && index < visibleRange.end,
              edgeRendered: edgeRenderedIds.has(m.id),
              streamingNeighbor: streamingNeighborIds.has(m.id),
            });
            return (
              <WindowedEditorialMessage
                key={m.id}
                message={m}
                modelName={renderBody && modelId ? (registry.findById(modelId)?.name ?? modelId) : undefined}
                streaming={m.id === chat.streamingMessageId}
                renderBody={renderBody}
                placeholderHeight={placeholderHeightForMessage(measuredMessageHeightsRef.current, m.id)}
                actionsDisabled={activeThreadStreaming || activeThread?.readOnly === true}
                laterMessageCount={Math.max(0, messages.length - originalIndex - 1)}
                onRegenerate={regenerateMessage}
                onBranch={branchMessage}
                onEditAndResend={editAndResendMessage}
                onMeasure={recordMessageHeight}
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

function WindowedEditorialMessage({
  message,
  modelName,
  streaming,
  renderBody,
  placeholderHeight,
  actionsDisabled,
  laterMessageCount,
  onRegenerate,
  onBranch,
  onEditAndResend,
  onMeasure,
}: {
  message: Message;
  modelName: string | undefined;
  streaming: boolean;
  renderBody: boolean;
  placeholderHeight: number;
  actionsDisabled: boolean;
  laterMessageCount: number;
  onRegenerate: (messageId: string) => void;
  onBranch: (messageId: string) => void;
  onEditAndResend: (messageId: string, text: string) => void;
  onMeasure: (messageId: string, height: number) => void;
}) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const setWrapperRef = useCallback((node: HTMLDivElement | null) => {
    wrapperRef.current = node;
  }, []);

  useLayoutEffect(() => {
    if (!renderBody) return;
    const node = wrapperRef.current;
    if (!node) return;
    const measure = () => {
      onMeasure(message.id, measureMessageElement(node));
    };
    measure();
    if (typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [message.id, onMeasure, renderBody]);

  return (
    <div ref={setWrapperRef} data-window-message-id={message.id}>
      {renderBody ? (
        <EditorialMessage
          message={message}
          modelName={modelName}
          streaming={streaming}
          actionsDisabled={actionsDisabled}
          laterMessageCount={laterMessageCount}
          onRegenerate={onRegenerate}
          onBranch={onBranch}
          onEditAndResend={onEditAndResend}
        />
      ) : (
        <div
          aria-hidden="true"
          data-message-placeholder={message.id}
          style={{ ...MESSAGE_PLACEHOLDER_STYLE, height: placeholderHeight }}
        />
      )}
    </div>
  );
}

function measureMessageElement(node: HTMLElement): number {
  return node.getBoundingClientRect().height || node.offsetHeight;
}
