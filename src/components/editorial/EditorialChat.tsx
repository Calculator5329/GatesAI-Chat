// The main chat view: the (windowed) message list, the composer, and the
// empty/first-run state. Rendered by the app shell; reads RootStore via hooks.
// Invariant: persisted chat state stays in stores; this surface is presentation only.
import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type WheelEvent } from 'react';
import { autorun } from 'mobx';
import { observer } from 'mobx-react-lite';
import { useEditorial } from '../../stores/context';
import { isTauri, isWebLite } from '../../core/runtime';
import { clientPlatform } from '../../core/clientPlatform';
import { recommendedDownload } from '../../core/downloads';
import { bestLocalModel } from '../../core/defaultModel';
import type { Message, Model } from '../../core/types';
import { groupMessagesByDate } from '../../core/threadSelectors';
import { Icons, SecretKeyField } from '../ui';
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
import { isNearScrollBottom, shouldDisengageScrollFollow } from './scrollFollow';

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
  // Bundled read-only conversations (such as the first-run welcome tour) are
  // reference material, not evidence that this person has already chatted.
  const hasPriorMessages = chat.threads.some(thread => !thread.readOnly && thread.messages.length > 0);
  const activeModel = registry.findById(chat.activeThread?.modelId ?? '');
  const activeProviderReady = activeModel
    ? providers.isConnected(activeModel.providerId)
    : providers.hasUsableProvider;
  const localFirstRunReady = !webLite
    && activeModel?.providerId === 'ollama'
    && activeProviderReady
    && !providers.getConfig('openrouter').apiKey;
  const [readyMessage, setReadyMessage] = useState<string | null>(null);

  useEffect(() => {
    if (hasPriorMessages && !ui.onboardingDismissed) ui.setOnboardingDismissed(true);
  }, [hasPriorMessages, ui]);

  const showOnboarding =
    !ui.onboardingDismissed
    && (!activeProviderReady || localFirstRunReady)
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
          : 'Chat locally on your own machine, run tools over your files, and bring frontier cloud models when you choose.'}
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

  useEffect(() => {
    if (webLite || !ollama.online || localModels.length === 0) return;
    // RootStore performs the same reconciliation as the registry hydrates.
    // Keep the first-run surface self-contained too: an empty untouched chat
    // adopts the detected local default, but an explicit model choice or a
    // thread with messages is never overwritten.
    chat.reconcileDefaultModelForEmptyThreads();
  }, [chat, localModels, ollama.online, webLite]);

  const activeLocalModel = localModels.find(model => model.id === chat.activeThread?.modelId);
  const localModelForChat = activeLocalModel ?? bestLocalModel(localModels);
  const selectLocalModel = useCallback(() => {
    const threadId = chat.activeThreadId;
    const model = localModelForChat;
    if (!threadId || !model) return;
    chat.setThreadModel(threadId, model.id);
    const message = `Ollama detected - ${formatModelCount(localModels.length)} ready.`;
    onReady(message);
    ui.setOnboardingDismissed(true);
    ui.focusComposer();
  }, [chat, localModelForChat, localModels.length, onReady, ui]);

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
      {!webLite && (
        <OllamaOnboardingCard
          models={localModels}
          selectedModel={localModelForChat}
          checking={localChecking || ollama.fetching || localRuntime.autoDetecting}
          error={localError ?? ollama.lastError ?? null}
          onRefresh={refreshLocal}
          onSelect={selectLocalModel}
          onStarterPull={startStarterPull}
        />
      )}

      <section className="editorial-onboarding__card" data-onboarding-path="cloud">
        <div className="editorial-onboarding__kicker">Cloud</div>
        <h2>Bring cloud models</h2>
        <p>
          Choose OpenRouter when you want a cloud model. Free and paid routes both use your own API key.
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
  selectedModel,
  checking,
  error,
  onRefresh,
  onSelect,
  onStarterPull,
}: {
  models: Model[];
  selectedModel: Model | undefined;
  checking: boolean;
  error: string | null;
  onRefresh: () => void;
  onSelect: () => void;
  onStarterPull: () => void;
}) {
  const { localRuntime, ollama, router } = useEditorial();
  const runtime = localRuntime.runtimes.ollama;
  const online = runtime.status === 'online';
  const ready = online && models.length > 0;
  const notDetected = !runtime.installPath && runtime.status !== 'online';
  const buttonLabel = checking ? 'Checking...' : 'Check again';
  const starter = 'llama3.2:3b';
  const starterState = ollama.pulls.get(starter);
  const openLocalSettings = () => router.goMenu('local');

  return (
    <section className="editorial-onboarding__card" data-onboarding-path="local">
      <div className="editorial-onboarding__kicker">Local</div>
      <h2>Start with local models</h2>
      {ready ? (
        <>
          <p>
            Ollama detected - {formatModelCount(models.length)} ready. {selectedModel?.name ?? 'A local model'}
            {' '}is selected for this chat, and GatesAI will not switch providers unless you choose another model.
          </p>
          <button type="button" className="editorial-empty-state__primary" onClick={onSelect}>
            Continue with {selectedModel?.name ?? 'local model'}
          </button>
        </>
      ) : online ? (
        <>
          <p>Ollama is running, but no chat models are pulled yet. Add one here and keep the whole conversation on this machine.</p>
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
          <button type="button" className="editorial-empty-state__secondary" onClick={openLocalSettings}>
            Open Local settings
          </button>
        </>
      ) : notDetected ? (
        <>
          <p>Run chat and tools on your machine with Ollama - no account or cloud key. Local settings can help you install or connect it.</p>
          <button type="button" className="editorial-empty-state__primary" onClick={openLocalSettings}>
            Open Local settings
          </button>
          <button type="button" className="editorial-empty-state__secondary" onClick={onRefresh} disabled={checking}>
            {buttonLabel}
          </button>
        </>
      ) : (
        <>
          <p>Ollama is configured but not running. Start it from Local settings; GatesAI will not silently fall back to cloud.</p>
          <button type="button" className="editorial-empty-state__primary" onClick={openLocalSettings}>
            Open Local settings
          </button>
          <button type="button" className="editorial-empty-state__secondary" onClick={onRefresh} disabled={checking}>
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
  // One pending consume per programmatic pin: the next scroll event is
  // ours and must not demote sticky; anything after it is the reader's.
  const pinConsumeRef = useRef(0);
  const streamRef = useRef<HTMLDivElement>(null);
  const windowingSupported = hasMessageWindowingSupport();
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  const [awayFromBottom, setAwayFromBottom] = useState(false);
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
  const visibleDateGroups = groupMessagesByDate(visibleMessages);
  const visibleMessageIds = visibleMessages.map(message => message.id);
  const visibleMessageIndexes = new Map(visibleMessages.map((message, index) => [message.id, index]));
  const edgeRenderedIds = edgeRenderedMessageIds(visibleMessageIds);
  const streamingNeighborIds = streamingNeighborMessageIds(visibleMessageIds, streamingId);
  const visibleRange = computeVisibleMessageRange({
    messageIds: visibleMessageIds,
    heights: measuredMessageHeightsRef.current,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
  });

  const scheduleScrollToBottom = useCallback(() => {
    // Pin synchronously first: rAF callbacks never run in hidden/unpainted
    // pages, and a pending frame id must never wedge future pins (an early
    // "if scheduled, return" here once parked one unexecuted frame at mount
    // and silently disabled every scroll-to-bottom after it, including the
    // jump button). The bounded rAF loop that follows is only a settle
    // assist: the windowed list grows scrollHeight over several frames while
    // message heights are measured, so we keep re-pinning until the bottom
    // holds still. Writes are stamped so the scroll listener can tell reader
    // intent apart from our own follow-up events.
    const now = scrollRef.current;
    if (now && stickyRef.current) {
      pinConsumeRef.current += 1;
      now.scrollTop = now.scrollHeight;
    }
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
    let settleFrames = 0;
    const pin = () => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (!el || !stickyRef.current) return;
      pinConsumeRef.current += 1;
      el.scrollTop = el.scrollHeight;
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 1;
      if ((!atBottom || settleFrames < 3) && settleFrames < 60) {
        settleFrames += 1;
        scrollRafRef.current = requestAnimationFrame(pin);
      }
    };
    scrollRafRef.current = requestAnimationFrame(pin);
  }, []);

  const jumpToBottom = useCallback(() => {
    stickyRef.current = true;
    setAwayFromBottom(false);
    scheduleScrollToBottom();
  }, [scheduleScrollToBottom]);

  const handleTimelineWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || !shouldDisengageScrollFollow(stickyRef.current, event.deltaY, el)) return;
    // Wheel fires before scroll. Record the reader's intent now so the next
    // streaming token cannot re-pin the viewport in between those events.
    stickyRef.current = false;
    pinConsumeRef.current = 0;
    setAwayFromBottom(true);
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
    if (scrollRafRef.current !== null) {
      cancelAnimationFrame(scrollRafRef.current);
      // Reset the guard: StrictMode runs this cleanup between its double
      // mount, and a cancelled frame never clears the ref itself — leaving
      // it stuck non-null would make every future scheduleScrollToBottom
      // early-return, silently disabling scroll-follow for the session.
      scrollRafRef.current = null;
    }
  }, []);

  // Content grows asynchronously (hydration, windowed height measurement,
  // images) long after any single scroll write. While the reader is following,
  // every growth of the stream re-pins the viewport to the bottom; once they
  // scroll up, stickyRef gates this off entirely.
  useEffect(() => {
    const stream = streamRef.current;
    const el = scrollRef.current;
    if (!stream || !el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!stickyRef.current) return;
      pinConsumeRef.current += 1;
      el.scrollTop = el.scrollHeight;
    });
    observer.observe(stream);
    return () => observer.disconnect();
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
      // Scroll events caused by our own pinning (or the layout shifts right
      // after it) must not demote sticky — only genuine reader scrolling may.
      // Reader wheel intent is captured separately in handleTimelineWheel.
      // Tolerances are asymmetric on purpose: leaving follow is generous
      // (STICKY_BOTTOM_PX) but re-engaging demands a deliberate return to the
      // true bottom, so one wheel-up near the bottom isn't instantly undone.
      const programmatic = pinConsumeRef.current > 0;
      if (programmatic) pinConsumeRef.current -= 1;
      if (stickyRef.current) {
        if (!programmatic && !isNearScrollBottom(el, STICKY_BOTTOM_PX)) {
          stickyRef.current = false;
          pinConsumeRef.current = 0;
          setAwayFromBottom(true);
        }
      } else if (!programmatic && isNearScrollBottom(el, 2)) {
        stickyRef.current = true;
        setAwayFromBottom(false);
      }
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
    setAwayFromBottom(false);
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
      setAwayFromBottom(false);
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

  // Response finished: reveal the final tail only if the reader was already
  // following the stream. Readers browsing history keep their position and
  // can use the jump pill when ready.
  useEffect(() => {
    const previous = previousStreamingIdRef.current;
    previousStreamingIdRef.current = streamingId;
    if (previous && !streamingId && stickyRef.current) {
      scheduleScrollToBottom();
    }
  }, [streamingId, scheduleScrollToBottom]);

  return (
    <div className="editorial-chat-shell" style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      minWidth: 0, background: 'var(--bg)', position: 'relative',
    }}>
      <div
        ref={scrollRef}
        className="editorial-chat-scroll"
        onWheelCapture={handleTimelineWheel}
        style={{ flex: 1, overflowY: 'auto', padding: '36px 48px 8px', overflowAnchor: 'none' }}
      >
        <div ref={streamRef} style={{ width: 'min(var(--reading-width, 720px), 70%)', margin: '0 auto' }} className="editorial-stream">
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
          {visibleDateGroups.map(group => (
            <Fragment key={`${group.key}-${group.messages[0]?.id ?? 'empty'}`}>
              <div className="editorial-date-separator" role="separator" aria-label={group.label}>
                <span>{group.label}</span>
              </div>
              {group.messages.map(m => {
                const index = visibleMessageIndexes.get(m.id) ?? 0;
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
            </Fragment>
          ))}
        </div>
      </div>
      {awayFromBottom && (
        <button
          type="button"
          className="editorial-jump-to-bottom"
          data-streaming={activeThreadStreaming || undefined}
          aria-label={activeThreadStreaming ? 'Jump to latest; new response tokens available' : 'Jump to latest'}
          onClick={jumpToBottom}
        >
          {activeThreadStreaming && <span className="editorial-jump-to-bottom__dot" aria-hidden="true" />}
          <span>{activeThreadStreaming ? 'New response' : 'Jump to latest'}</span>
          <span className="editorial-jump-to-bottom__arrow" aria-hidden="true"><Icons.ArrowUp /></span>
        </button>
      )}
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
