// Owns observable RootStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { autorun, reaction } from 'mobx';
import { ChatStore } from './ChatStore';
import { UiStore } from './UiStore';
import { ProviderStore } from './ProviderStore';
import { RouterStore } from './RouterStore';
import { ModelRegistry } from './ModelRegistry';
import { OpenRouterStore } from './OpenRouterStore';
import { OllamaStore } from './OllamaStore';
import { UserProfileStore } from './UserProfileStore';
import { SummaryStore } from './SummaryStore';
import { NotesStore } from './NotesStore';
import { BridgeStore } from './BridgeStore';
import { ExecStreamStore } from './ExecStreamStore';
import { ImageGenStore } from './ImageGenStore';
import { ImageJobStore } from './ImageJobStore';
import { LocalRuntimeStore } from './LocalRuntimeStore';
import { SearchStore } from './SearchStore';
import { OpenRouterCompatibilityStore } from './OpenRouterCompatibilityStore';
import { configureChatLog } from '../services/diagnostics/chatLog';
import { isWebLite } from '../services/system/runtime';

export class RootStore {
  readonly registry: ModelRegistry;
  readonly providers: ProviderStore;
  readonly profile: UserProfileStore;
  readonly chat: ChatStore;
  readonly ui: UiStore;
  readonly router: RouterStore;
  readonly openrouter: OpenRouterStore;
  readonly ollama: OllamaStore;
  readonly summary: SummaryStore;
  readonly notes: NotesStore;
  readonly bridge: BridgeStore;
  readonly execStream: ExecStreamStore;
  readonly imageGen: ImageGenStore;
  readonly imageJobs: ImageJobStore;
  readonly localRuntime: LocalRuntimeStore;
  readonly search: SearchStore;
  readonly openrouterCompatibility: OpenRouterCompatibilityStore;

  constructor() {
    let ollamaStore: OllamaStore | null = null;
    this.registry = new ModelRegistry();
    this.profile = new UserProfileStore();
    this.ui = new UiStore();
    this.router = new RouterStore();
    this.openrouter = new OpenRouterStore(this.registry);
    this.localRuntime = new LocalRuntimeStore({
      getOllamaCatalog: () => ollamaStore?.catalog ?? [],
    });
    this.search = new SearchStore();
    this.ollama = new OllamaStore(this.registry, this.localRuntime);
    ollamaStore = this.ollama;
    this.providers = new ProviderStore(this.registry, () => ({
      ollama: {
        baseUrl: this.localRuntime.ollamaBaseUrl,
        apiKey: this.ollama.config.apiKey,
        available: this.localRuntime.runtimes.ollama.status === 'online',
        toolsEnabled: this.ollama.config.toolsEnabled,
      },
    }));
    let attemptedOpenRouterCatalogHydrationForKey: string | null = null;
    autorun(() => {
      const key = this.providers.getConfig('openrouter').apiKey;
      if (!key) {
        attemptedOpenRouterCatalogHydrationForKey = null;
        return;
      }
      if (
        attemptedOpenRouterCatalogHydrationForKey !== key
        && this.openrouter.count === 0
        && !this.openrouter.fetching
      ) {
        attemptedOpenRouterCatalogHydrationForKey = key;
        void this.openrouter.refresh();
      }
    });
    this.chat = new ChatStore(this.providers, this.registry, this.profile);
    this.summary = new SummaryStore(this.chat, this.providers, this.registry);
    this.notes = new NotesStore();
    this.bridge = new BridgeStore();
    this.openrouterCompatibility = new OpenRouterCompatibilityStore(this.providers, this.registry, this.bridge);
    this.execStream = new ExecStreamStore();
    this.imageGen = new ImageGenStore(this.localRuntime, () => this.providers.getConfig('openrouter').apiKey);
    this.imageJobs = new ImageJobStore({
      bridge: this.bridge,
      imageGen: this.imageGen,
      onTerminal: job => this.chat.notifyImageJobTerminal(job),
    });

    let attemptedWorkspacePersistenceRoot: string | undefined;
    let workspacePersistenceAttemptInFlight = false;
    autorun(() => {
      if (isWebLite()) return;
      if (!this.bridge.isOnline || !this.bridge.workspaceRoot) return;
      if (attemptedWorkspacePersistenceRoot === this.bridge.workspaceRoot) return;
      if (workspacePersistenceAttemptInFlight) return;
      const workspaceRoot = this.bridge.workspaceRoot;
      workspacePersistenceAttemptInFlight = true;
      void this.bridge.client.connect()
        .then(() => this.chat.enableWorkspacePersistence(this.bridge.client))
        .then(ok => {
          if (ok) attemptedWorkspacePersistenceRoot = workspaceRoot;
        })
        .catch(err => { console.warn('[persistence] workspace chat persistence boot failed', err); })
        .finally(() => { workspacePersistenceAttemptInFlight = false; });
    });

    // Cross-thread awareness: ChatStore asks SummaryStore for the digest
    // list every time it composes a system prompt. Wiring is one-way
    // (Chat → Summary read) so the dependency graph stays acyclic.
    this.chat.setRecentSummariesProvider(() =>
      this.summary.recentSummariesExcluding(this.chat.activeThreadId)
    );

    // Auxiliary stores tools need at execution time. Lazy getter so the
    // wiring stays one-way (tools reach back through ChatStore's context).
    this.chat.setToolStoresProvider(() => ({
      notes: this.notes,
      summary: this.summary,
      bridge: this.bridge,
      execStream: this.execStream,
      imageGen: this.imageGen,
      imageJobs: this.imageJobs,
      localRuntime: this.localRuntime,
      search: this.search,
    }));

    const deliveredBridgeActivityIds = new Set<string>();
    autorun(() => {
      const events = this.bridge.activityEvents.filter(event => !deliveredBridgeActivityIds.has(event.id));
      for (const event of events) this.chat.recordActivityEvent(event);
      for (const event of events) deliveredBridgeActivityIds.add(event.id);
    });

    if (!isWebLite()) {
      // Boot the bridge poller - chat keeps working if it never connects.
      this.bridge.start();
      void this.localRuntime.init();

      // Diagnostics: route per-thread log lines to /workspace/logs/<id>.log
      // through the bridge whenever it's online.
      const bridge = this.bridge;
      configureChatLog({
        get isOnline() { return bridge.isOnline; },
        client: bridge.client,
      });
    }

    // Boot the lazy summarizer.
    this.summary.start();

    this.bindRouterToChat();
  }

  /**
   * Two-way binding between the URL hash and the chat's active thread.
   * - On load / back/forward: a thread route selects the matching thread,
   *   falling back to the chat's existing active thread if the id is unknown
   *   (e.g. a stale link).
   * - When the user clicks a thread in the sidebar, ChatStore.selectThread
   *   updates `activeThreadId`, and this autorun pushes that into the URL.
   */
  private bindRouterToChat(): void {
    // URL → store
    reaction(
      () => ({
        route: this.router.route,
        activeThreadId: this.chat.activeThreadId,
        threadIds: this.chat.threads.map(t => t.id).join('\0'),
      }),
      ({ route, activeThreadId }) => {
        if (route.kind !== 'thread') return;
        const id = route.threadId;
        if (id && this.chat.threads.some(t => t.id === id)) {
          if (activeThreadId !== id && !this.chat.selectThread(id) && this.chat.activeThreadId) {
            this.router.goThread(this.chat.activeThreadId);
          }
        } else if (!id && activeThreadId) {
          // bare `#/` → reflect current active thread back into the URL
          this.router.goThread(activeThreadId);
        } else if (id && activeThreadId) {
          this.router.goThread(activeThreadId);
        }
      },
      { fireImmediately: true },
    );

    // store → URL (only while we're on the thread surface; menu routes are explicit)
    reaction(
      () => ({ route: this.router.route, activeThreadId: this.chat.activeThreadId }),
      ({ route, activeThreadId }) => {
        if (route.kind !== 'thread') return;
        if (activeThreadId && route.threadId !== activeThreadId) this.router.goThread(activeThreadId);
      },
      { fireImmediately: true },
    );
  }
}

export const rootStore = new RootStore();

// Dev-only console hook: open DevTools and run `__gatesai.clearAll()` to wipe
// every conversation in one shot. Removed in production builds. Replace with
// a proper menu action when we add UI for this.
if (import.meta.env.DEV) {
  const devWindow = window as Window & { __gatesai?: unknown };
  devWindow.__gatesai = {
    clearAll: () => rootStore.chat.clearAllThreads(),
    store: rootStore,
  };
}
