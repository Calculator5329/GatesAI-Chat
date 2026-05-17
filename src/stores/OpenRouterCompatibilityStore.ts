import { makeAutoObservable, runInAction } from 'mobx';
import type { BridgeStore } from './BridgeStore';
import type { ModelRegistry } from './ModelRegistry';
import type { ProviderStore } from './ProviderStore';
import {
  runOpenRouterCompatibility,
  selectOpenRouterCompatibilityTargets,
  type OpenRouterCompatibilityMode,
  type OpenRouterCompatibilityRun,
} from '../services/compat/openRouterCompatibility';

export class OpenRouterCompatibilityStore {
  running = false;
  progress = '';
  completed = 0;
  total = 0;
  lastRun: OpenRouterCompatibilityRun | null = null;
  lastError: string | null = null;
  logLines: string[] = [];

  private abortController: AbortController | null = null;
  private readonly providers: ProviderStore;
  private readonly registry: ModelRegistry;
  private readonly bridge: BridgeStore;

  constructor(providers: ProviderStore, registry: ModelRegistry, bridge: BridgeStore) {
    this.providers = providers;
    this.registry = registry;
    this.bridge = bridge;
    makeAutoObservable<this, 'providers' | 'registry' | 'bridge' | 'abortController'>(this, {
      providers: false,
      registry: false,
      bridge: false,
      abortController: false,
    });
  }

  get openRouterReady(): boolean {
    return this.providers.isConnected('openrouter');
  }

  get workspaceReady(): boolean {
    return this.bridge.isOnline;
  }

  get curatedCount(): number {
    return selectOpenRouterCompatibilityTargets(this.registry.all, 'curated').length;
  }

  get sampleCount(): number {
    return selectOpenRouterCompatibilityTargets(this.registry.all, 'sample').length;
  }

  get allCount(): number {
    return selectOpenRouterCompatibilityTargets(this.registry.all, 'all').length;
  }

  async start(mode: OpenRouterCompatibilityMode): Promise<void> {
    if (this.running) return;
    if (!this.openRouterReady) {
      this.lastError = 'Add an OpenRouter API key before running compatibility tests.';
      return;
    }
    if (!this.workspaceReady) {
      this.lastError = 'Start the workspace bridge before running compatibility tests.';
      return;
    }

    const controller = new AbortController();
    this.abortController = controller;
    runInAction(() => {
      this.running = true;
      this.completed = 0;
      this.total = 0;
      this.progress = 'Starting OpenRouter compatibility run...';
      this.lastError = null;
      this.logLines = [this.progress];
    });

    try {
      const run = await runOpenRouterCompatibility({
        mode,
        models: this.registry.all,
        router: this.providers.router,
        bridge: this.bridge.client,
        signal: controller.signal,
        onProgress: progress => {
          runInAction(() => {
            this.completed = progress.completed;
            this.total = progress.total;
            this.progress = progress.line;
            this.logLines = [...this.logLines.slice(-11), progress.line];
          });
        },
      });
      runInAction(() => {
        this.lastRun = run;
        this.progress = `Finished: ${run.passed}/${run.total} passed`;
        this.logLines = [...this.logLines.slice(-11), this.progress, `Report: ${run.reportPath}`];
      });
    } catch (err) {
      runInAction(() => {
        this.lastError = err instanceof Error ? err.message : String(err);
        this.progress = 'Compatibility run failed';
        this.logLines = [...this.logLines.slice(-11), this.lastError];
      });
    } finally {
      runInAction(() => {
        this.running = false;
        if (this.abortController === controller) this.abortController = null;
      });
    }
  }

  cancel(): void {
    this.abortController?.abort();
    this.progress = 'Cancelling compatibility run...';
  }
}
