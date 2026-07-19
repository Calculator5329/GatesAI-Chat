// Owns observable RootStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { autorun, reaction, runInAction } from 'mobx';
import { ChatStore } from './ChatStore';
import { DockStore } from './DockStore';
import { ArtifactStore } from './ArtifactStore';
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
import { UpdateStore } from './UpdateStore';
import { ImageGenStore } from './ImageGenStore';
import { ImageJobStore } from './ImageJobStore';
import { TaskStore } from './TaskStore';
import { LocalRuntimeStore } from './LocalRuntimeStore';
import { SearchStore } from './SearchStore';
import { SkillsStore } from './SkillsStore';
import { WhatsNewStore } from './WhatsNewStore';
import { seedWelcomeTourOnFirstRun } from '../tourThread';
import { RagStore } from '../services/rag/RagStore';
import { configureChatLog } from '../services/diagnostics/chatLog';
import { configureLogSink, logger } from '../services/diagnostics/logger';
import { installMultiTabStorageListener } from '../services/storage/persistenceProvider';
import { purgeRetiredLocalSlots } from '../services/persistence/retiredSlots';
import { WebLocksLeaderElection } from '../services/storage/webLocksLeaderElection';
import { toolRegistry } from '../services/tools/registry';
import { runtimeMode, type GatesRuntimeMode } from '../core/runtime';
import {
  downloadDataExport,
  formatDataImportResult,
  importDataFromJson,
  REPLACE_IMPORT_CONFIRMATION,
  type DataImportMode,
  type DataImportResult,
} from '../services/chat/dataExport';
import { getSecret, migrateDesktopSecretsFromLocalStorage, SECRET_NAMES } from '../services/secretStorage';
import { UndoService } from '../services/undo/UndoService';

export class RootStore {
  readonly registry: ModelRegistry;
  readonly providers: ProviderStore;
  readonly profile: UserProfileStore;
  readonly undo: UndoService;
  readonly chat: ChatStore;
  readonly chatLeaderElection: WebLocksLeaderElection;
  readonly ui: UiStore;
  readonly dock: DockStore;
  readonly artifacts: ArtifactStore;
  readonly router: RouterStore;
  readonly openrouter: OpenRouterStore;
  readonly ollama: OllamaStore;
  readonly summary: SummaryStore;
  readonly notes: NotesStore;
  readonly bridge: BridgeStore;
  readonly updates: UpdateStore;
  readonly execStream: ExecStreamStore;
  readonly imageGen: ImageGenStore;
  readonly imageJobs: ImageJobStore;
  readonly tasks: TaskStore;
  readonly localRuntime: LocalRuntimeStore;
  readonly search: SearchStore;
  readonly skills: SkillsStore;
  readonly rag: RagStore;
  readonly whatsNew: WhatsNewStore;
  private booted = false;
  readonly runtime: GatesRuntimeMode;
  private readonly disposers: Array<() => void> = [];
  readonly replaceImportConfirmation = REPLACE_IMPORT_CONFIRMATION;

  constructor(options: { runtime?: GatesRuntimeMode } = {}) {
    this.runtime = options.runtime ?? runtimeMode();
    let ollamaStore: OllamaStore | null = null;
    this.registry = new ModelRegistry();
    this.profile = new UserProfileStore();
    this.undo = new UndoService();
    this.ui = new UiStore();
    this.dock = new DockStore({ runtime: this.runtime });
    this.whatsNew = new WhatsNewStore();
    this.router = new RouterStore();
    this.localRuntime = new LocalRuntimeStore({
      getOllamaCatalog: () => ollamaStore?.catalog ?? [],
    });
    this.search = new SearchStore(undefined, { autoPersist: false });
    this.ollama = new OllamaStore(this.registry, this.localRuntime, { autoPersist: false });
    ollamaStore = this.ollama;
    this.providers = new ProviderStore(this.registry, () => ({
      ollama: {
        baseUrl: this.localRuntime.ollamaBaseUrl,
        apiKey: this.ollama.config.apiKey,
        available: this.localRuntime.runtimes.ollama.status === 'online',
        toolsEnabled: this.ollama.config.toolsEnabled,
      },
    }), { autoPersist: false });
    this.openrouter = new OpenRouterStore(this.registry, () => this.providers.getConfig('openrouter').apiKey);
    this.chatLeaderElection = new WebLocksLeaderElection();
    this.chat = new ChatStore(
      this.providers,
      this.registry,
      this.profile,
      () => this.ui.autoNamingEnabled,
      this.chatLeaderElection,
      this.undo,
    );
    seedWelcomeTourOnFirstRun(this.chat, this.whatsNew);
    this.summary = new SummaryStore(this.chat, this.providers, this.registry);
    this.notes = new NotesStore();
    this.rag = new RagStore({
      getSources: () => ({
        threads: this.chat.threads,
        notes: this.notes.notes,
        facts: this.profile.facts,
      }),
      getOllamaOnline: () => this.ollama.online,
      getOllamaTagNames: () => this.ollama.tagNames,
      getOllamaBaseUrl: () => this.localRuntime.ollamaBaseUrl,
      getOllamaApiKey: () => this.ollama.config.apiKey,
      isStreaming: () => this.chat.threads.some(thread => this.chat.isThreadStreaming(thread.id)),
    });
    this.bridge = new BridgeStore();
    this.artifacts = new ArtifactStore(this.bridge);
    this.skills = new SkillsStore(this.bridge, () => toolRegistry.list().map(tool => tool.def.name));
    this.updates = new UpdateStore();
    this.execStream = new ExecStreamStore();
    this.imageGen = new ImageGenStore(this.localRuntime, () => this.providers.getConfig('openrouter').apiKey);
    this.imageJobs = new ImageJobStore({
      bridge: this.bridge,
      imageGen: this.imageGen,
      onTerminal: job => this.chat.notifyImageJobTerminal(job),
    });
    this.tasks = new TaskStore(this.imageJobs, this.chat);

    // Cross-thread awareness: ChatStore asks SummaryStore for the digest
    // list every time it composes a system prompt. Wiring is one-way
    // (Chat → Summary read) so the dependency graph stays acyclic.
    this.chat.setRecentSummariesProvider(() =>
      this.summary.recentSummariesExcluding(this.chat.activeThreadId)
    );
    this.chat.setSemanticContextProvider(userText => this.rag.semanticContextForUserText(userText));
    this.chat.setActiveSkillProvider(threadId => this.skills.findById(this.chat.threads.find(t => t.id === threadId)?.skillId));

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
      rag: this.rag,
      artifacts: this.artifacts,
      artifactSurface: this.dock,
    }));
  }

  boot(): void {
    if (this.booted) return;
    this.booted = true;
    purgeRetiredLocalSlots();
    void this.hydrateSecretsAtBoot();

    let attemptedOpenRouterCatalogHydrationForKey: string | null = null;
    this.disposers.push(autorun(() => {
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
    }));

    let attemptedOllamaCatalogHydrationForKey: string | null = null;
    this.disposers.push(autorun(() => {
      const online = this.localRuntime.runtimes.ollama.status === 'online';
      const key = `${this.localRuntime.ollamaBaseUrl}|${this.ollama.config.apiKey ?? ''}`;
      if (!online) {
        attemptedOllamaCatalogHydrationForKey = null;
        return;
      }
      if (
        attemptedOllamaCatalogHydrationForKey !== key
        && this.ollama.count === 0
        && !this.ollama.fetching
      ) {
        attemptedOllamaCatalogHydrationForKey = key;
        void this.ollama.refresh();
      }
    }));

    let attemptedWorkspacePersistenceRoot: string | undefined;
    let workspacePersistenceAttemptInFlight = false;
    this.disposers.push(autorun(() => {
      if (this.runtime !== 'desktop') return;
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
        .catch(err => { logger.warn('persistence', 'workspace chat persistence boot failed', err); })
        .finally(() => { workspacePersistenceAttemptInFlight = false; });
    }));

    let attemptedSkillsRoot: string | undefined;
    let skillsRefreshInFlight = false;
    this.disposers.push(autorun(() => {
      if (this.runtime !== 'desktop') return;
      if (!this.bridge.isOnline || !this.bridge.workspaceRoot) return;
      if (attemptedSkillsRoot === this.bridge.workspaceRoot) return;
      if (skillsRefreshInFlight) return;
      const workspaceRoot = this.bridge.workspaceRoot;
      skillsRefreshInFlight = true;
      void this.skills.refresh()
        .then(() => { attemptedSkillsRoot = workspaceRoot; })
        .catch(err => { logger.warn('skills', 'workspace skills refresh failed', err); })
        .finally(() => { skillsRefreshInFlight = false; });
    }));

    let attemptedArtifactRoot: string | undefined;
    let artifactRefreshInFlight = false;
    this.disposers.push(autorun(() => {
      if (this.runtime !== 'desktop') return;
      if (!this.bridge.isOnline || !this.bridge.workspaceRoot) return;
      if (attemptedArtifactRoot === this.bridge.workspaceRoot || artifactRefreshInFlight) return;
      const workspaceRoot = this.bridge.workspaceRoot;
      artifactRefreshInFlight = true;
      void this.artifacts.refresh()
        .then(() => { attemptedArtifactRoot = workspaceRoot; })
        .finally(() => { artifactRefreshInFlight = false; });
    }));

    const deliveredBridgeActivityIds = new Set<string>();
    this.disposers.push(autorun(() => {
      const events = this.bridge.activityEvents.filter(event => !deliveredBridgeActivityIds.has(event.id));
      for (const event of events) this.chat.recordActivityEvent(event);
      for (const event of events) deliveredBridgeActivityIds.add(event.id);
    }));

    if (this.runtime === 'desktop') {
      this.bridge.start();
      void this.localRuntime.init();
      this.updates.startBackgroundChecks();

      const bridge = this.bridge;
      configureChatLog({
        get isOnline() { return bridge.isOnline; },
        client: bridge.client,
      });
      configureLogSink({
        get isOnline() { return bridge.isOnline; },
        client: bridge.client,
      });
    }

    this.summary.start();
    this.rag.start();
    if (this.runtime !== 'headless') {
      this.disposers.push(installMultiTabStorageListener());
      this.chatLeaderElection.start();
    }

    this.disposers.push(autorun(() => {
      if (this.ui.onboardingDismissed) return;
      if (this.chat.threads.some(thread => thread.messages.length > 0)) {
        this.ui.setOnboardingDismissed(true);
      }
    }));

    this.disposers.push(autorun(() => {
      void this.chat.defaultModelId;
      void this.registry.all.length;
      runInAction(() => this.chat.reconcileDefaultModelForEmptyThreads());
    }));

    let boundDraftThreadId: string | null = null;
    this.disposers.push(autorun(() => {
      const id = this.chat.activeThreadId;
      if (id === boundDraftThreadId) return;
      this.ui.bindDraftThread(id);
      boundDraftThreadId = id;
    }));

    if (this.runtime !== 'headless') this.bindRouterToChat();
  }

  dispose(): void {
    while (this.disposers.length > 0) this.disposers.pop()?.();
    this.summary.stop();
    this.rag.dispose();
    this.bridge.stop();
    this.providers.dispose();
    this.search.dispose();
    this.ollama.dispose();
    this.chat.dispose();
    this.undo.clear();
    // Flush the departing leader while it still owns the lock, then release
    // it so a queued follower can refresh and take over safely.
    this.chatLeaderElection.dispose();
    this.dock.dispose();
    this.ui.dispose();
    this.router.destroy();
    this.booted = false;
  }

  downloadDataExport(): void {
    downloadDataExport(this);
  }

  importDataFromJson(raw: string, mode: DataImportMode): DataImportResult {
    return importDataFromJson(this, raw, mode);
  }

  formatDataImportResult(result: DataImportResult): string {
    return formatDataImportResult(result);
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
    this.disposers.push(reaction(
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
    ));

    // store → URL (only while we're on the thread surface; menu routes are explicit)
    this.disposers.push(reaction(
      () => ({ route: this.router.route, activeThreadId: this.chat.activeThreadId }),
      ({ route, activeThreadId }) => {
        if (route.kind !== 'thread') return;
        if (activeThreadId && route.threadId !== activeThreadId) this.router.goThread(activeThreadId);
      },
      { fireImmediately: true },
    ));
  }

  private async hydrateSecretsAtBoot(): Promise<void> {
    const migration = await migrateDesktopSecretsFromLocalStorage().catch(err => {
      logger.warn('persistence', 'desktop secret migration failed during boot', { err });
      return null;
    });
    if (!migration) return;
    if (!migration.ok) return;

    try {
      const [openrouterKey, braveKey, ollamaKey] = await Promise.all([
        getSecret(SECRET_NAMES.openrouterApiKey),
        getSecret(SECRET_NAMES.braveApiKey),
        getSecret(SECRET_NAMES.ollamaApiKey),
      ]);
      if (!this.booted) return;
      this.providers.hydrateOpenRouterKey(openrouterKey);
      this.search.hydrateBraveKey(braveKey);
      this.ollama.hydrateApiKey(ollamaKey);
    } catch (err) {
      logger.warn('persistence', 'secret hydration failed', { err });
    } finally {
      if (this.booted) {
        this.providers.startPersistence();
        this.search.startPersistence();
        this.ollama.startPersistence();
      }
    }
  }
}

export const rootStore = new RootStore();

// Dev-only console hook: open DevTools and run `__gatesai.clearAll()` to wipe
// every conversation in one shot. Removed in production builds. Replace with
// a proper menu action when we add UI for this.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  const devWindow = window as Window & { __gatesai?: unknown };
  devWindow.__gatesai = {
    clearAll: () => rootStore.chat.clearAllThreads(),
    store: rootStore,
  };
}
