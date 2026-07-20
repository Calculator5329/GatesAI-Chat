/* eslint-disable no-restricted-imports -- Task-local MobX store lives with the RAG service module. */
import { autorun, makeAutoObservable, reaction, runInAction, toJS } from 'mobx';
import { DEFAULT_RAG_EMBEDDING_MODEL, OllamaEmbeddingClient, type RagEmbedder } from './embeddings';
import { formatStructuredRecallResults, formatSemanticContextBlock } from './format';
import { RagIndexer, type RagSourceSnapshot } from './indexer';
import { RagVectorStore, type RagSearchResult } from './vectorStore';
import type { RagSourceRepository } from './sourceRepository';
import { logger } from '../diagnostics/logger';
import { messageText } from '../../core/messageParts';
import { retrieveHybrid, type RagRetrievalRequest, type RagRetrievalResult } from './retrieval';

export interface RagSettings {
  autoInject: boolean;
  embeddingModel: string;
}

export interface RagStoreDeps {
  getSources(): RagSourceSnapshot;
  getOllamaOnline(): boolean;
  getOllamaTagNames(): string[];
  getOllamaBaseUrl(): string;
  getOllamaApiKey?(): string | undefined;
  isStreaming(): boolean;
  embedder?: RagEmbedder;
  vectorStore?: RagVectorStore;
  sourceRepository?: RagSourceRepository;
  storage?: Storage;
}

export type RagStatus = 'active' | 'ollama_offline' | 'model_missing';
export type RagIndexPhase = 'idle' | 'scanning' | 'embedding' | 'committing' | 'paused' | 'failed' | 'empty';

export const RAG_SETTINGS_STORAGE_KEY = 'gatesai.rag.settings.v1';
export const RAG_INDEX_DEBOUNCE_MS = 5_000;
export const RAG_INJECTION_LIMIT = 3;
export const RAG_INJECTION_MAX_CHARS = 2_000;

export class RagStore {
  settings: RagSettings;
  indexedChunkCount = 0;
  indexing = false;
  lastIndexedAt: number | null = null;
  phase: RagIndexPhase = 'idle';
  sourcesCompleted = 0;
  sourcesTotal = 0;
  chunksCompleted = 0;
  chunksTotal = 0;
  activeGenerationAt: number | null = null;
  activeGenerationModel: string | null = null;
  lastError: { code: string; message: string } | null = null;
  servingCompleteGeneration = false;

  private readonly getSources: () => RagSourceSnapshot;
  private readonly getOllamaOnline: () => boolean;
  private readonly getOllamaTagNames: () => string[];
  private readonly isStreaming: () => boolean;
  private readonly storage?: Storage;
  private readonly vectorStore: RagVectorStore;
  private readonly embedder: RagEmbedder;
  private readonly indexer: RagIndexer;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private disposers: Array<() => void> = [];
  private abortController: AbortController | null = null;

  constructor(deps: RagStoreDeps) {
    this.getSources = deps.getSources;
    this.getOllamaOnline = deps.getOllamaOnline;
    this.getOllamaTagNames = deps.getOllamaTagNames;
    this.isStreaming = deps.isStreaming;
    this.storage = deps.storage ?? (typeof localStorage === 'undefined' ? undefined : localStorage);
    this.settings = loadSettings(this.storage);
    this.vectorStore = deps.vectorStore ?? new RagVectorStore();
    this.embedder = deps.embedder ?? new OllamaEmbeddingClient({
      getBaseUrl: deps.getOllamaBaseUrl,
      getApiKey: deps.getOllamaApiKey,
    });
    this.indexer = new RagIndexer({
      vectorStore: this.vectorStore,
      embedder: this.embedder,
      getSources: () => deps.sourceRepository?.load() ?? this.getSources(),
      getModel: () => this.embeddingModel,
      getActive: () => this.active,
      isStreaming: this.isStreaming,
      onProgress: progress => runInAction(() => {
        this.phase = progress.phase;
        this.sourcesCompleted = progress.sourcesCompleted;
        this.sourcesTotal = progress.sourcesTotal;
        this.chunksCompleted = progress.chunksCompleted;
        this.chunksTotal = progress.chunksTotal;
      }),
    });

    makeAutoObservable<this,
      'getSources'
      | 'getOllamaOnline'
      | 'getOllamaTagNames'
      | 'isStreaming'
      | 'storage'
      | 'vectorStore'
      | 'embedder'
      | 'indexer'
      | 'timer'
      | 'disposers'
      | 'abortController'
    >(this, {
      getSources: false,
      getOllamaOnline: false,
      getOllamaTagNames: false,
      isStreaming: false,
      storage: false,
      vectorStore: false,
      embedder: false,
      indexer: false,
      timer: false,
      disposers: false,
      abortController: false,
    });

    this.disposers.push(autorun(() => saveSettings(toJS(this.settings), this.storage)));
  }

  get embeddingModel(): string {
    return this.settings.embeddingModel.trim() || DEFAULT_RAG_EMBEDDING_MODEL;
  }

  get status(): RagStatus {
    if (!this.getOllamaOnline()) return 'ollama_offline';
    const model = this.embeddingModel;
    return this.getOllamaTagNames().some(name => name.startsWith(model)) ? 'active' : 'model_missing';
  }

  get active(): boolean {
    return this.status === 'active';
  }

  start(): void {
    if (this.disposers.length > 1) return;
    this.disposers.push(reaction(
      () => ({
        active: this.active,
        streaming: this.isStreaming(),
        model: this.embeddingModel,
        digest: sourceDigest(this.getSources()),
      }),
      state => {
        if (state.streaming) {
          this.abortController?.abort();
          if (this.indexing) this.phase = 'paused';
        } else if (state.active) {
          this.scheduleIndex();
        }
      },
      { fireImmediately: true },
    ));
    void this.refreshCount();
    void this.refreshManifest();
  }

  dispose(): void {
    this.clearTimer();
    this.abortController?.abort();
    while (this.disposers.length > 0) this.disposers.pop()?.();
  }

  setAutoInject(value: boolean): void {
    this.settings.autoInject = value;
  }

  setEmbeddingModel(value: string): void {
    this.settings.embeddingModel = value.trim() || DEFAULT_RAG_EMBEDDING_MODEL;
    this.scheduleIndex();
  }

  scheduleIndex(): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runIndexOnce();
    }, RAG_INDEX_DEBOUNCE_MS);
  }

  async runIndexOnce(): Promise<void> {
    if (!this.active || this.isStreaming()) return;
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    runInAction(() => {
      this.indexing = true;
      this.phase = 'scanning';
      this.lastError = null;
    });
    try {
      await this.indexer.tick(controller.signal);
      await this.refreshCount();
      await this.refreshManifest();
      runInAction(() => {
        this.lastIndexedAt = Date.now();
        this.phase = this.indexedChunkCount > 0 ? 'idle' : 'empty';
      });
    } catch (err) {
      const aborted = controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError');
      runInAction(() => {
        this.phase = aborted ? 'paused' : 'failed';
        if (!aborted) this.lastError = { code: 'index_failed', message: err instanceof Error ? err.message : String(err) };
      });
      logger.warn('rag', aborted ? 'indexing paused' : 'indexing failed', { code: aborted ? 'aborted' : 'index_failed' });
    } finally {
      if (this.abortController === controller) this.abortController = null;
      runInAction(() => { this.indexing = false; });
    }
  }

  async rebuildIndex(): Promise<void> {
    if (!this.active || this.isStreaming()) return;
    this.abortController?.abort();
    const controller = new AbortController();
    this.abortController = controller;
    runInAction(() => {
      this.indexing = true;
      this.phase = 'scanning';
      this.lastError = null;
    });
    try {
      await this.indexer.rebuild(controller.signal);
      await this.refreshCount();
      await this.refreshManifest();
      runInAction(() => {
        this.lastIndexedAt = Date.now();
        this.phase = this.indexedChunkCount > 0 ? 'idle' : 'empty';
      });
    } catch (err) {
      const aborted = controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError');
      runInAction(() => {
        this.phase = aborted ? 'paused' : 'failed';
        if (!aborted) this.lastError = { code: 'rebuild_failed', message: err instanceof Error ? err.message : String(err) };
      });
    } finally {
      if (this.abortController === controller) this.abortController = null;
      runInAction(() => { this.indexing = false; });
    }
  }

  async clearIndex(): Promise<void> {
    await this.vectorStore.clear();
    this.indexer.clearWatermarks();
    await this.refreshCount();
    runInAction(() => {
      this.phase = 'empty';
      this.servingCompleteGeneration = false;
      this.activeGenerationAt = null;
      this.activeGenerationModel = null;
    });
  }

  async search(query: string, k = 6): Promise<RagSearchResult[]> {
    if (!this.active) return [];
    const trimmed = query.trim();
    if (!trimmed) return [];
    const [vector] = await this.embedder.embed([trimmed], this.embeddingModel);
    if (!vector) return [];
    return this.vectorStore.search(vector, this.embeddingModel, k);
  }

  async recall(query: string, k = 6): Promise<string> {
    const results = await this.retrieve({
      query,
      purpose: 'explicit_recall',
      limit: k,
    });
    return formatStructuredRecallResults(results);
  }

  async retrieve(request: RagRetrievalRequest): Promise<RagRetrievalResult[]> {
    if (!this.active) return [];
    return retrieveHybrid({
      request,
      model: this.embeddingModel,
      embedder: this.embedder,
      vectorStore: this.vectorStore,
    });
  }

  async semanticContextForUserText(text: string, activeThreadId?: string): Promise<string> {
    if (!this.active || !this.settings.autoInject) return '';
    const results = await this.retrieve({
      query: text,
      purpose: 'automatic_context',
      activeThreadId,
      limit: RAG_INJECTION_LIMIT,
    });
    const sources = this.getSources();
    return formatSemanticContextBlock(
      results.map(result => ({ chunk: result.chunk, score: result.fusedScore })),
      { threads: sources.threads, notes: sources.notes },
      RAG_INJECTION_MAX_CHARS,
    );
  }

  private async refreshCount(): Promise<void> {
    const count = await this.vectorStore.count(this.embeddingModel).catch(() => 0);
    runInAction(() => { this.indexedChunkCount = count; });
  }

  private async refreshManifest(): Promise<void> {
    const manifest = await this.vectorStore.activeManifest().catch(() => null);
    runInAction(() => {
      this.servingCompleteGeneration = Boolean(manifest);
      this.activeGenerationAt = manifest?.completedAt ?? null;
      this.activeGenerationModel = manifest?.embeddingModel ?? null;
    });
  }

  private clearTimer(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = null;
  }
}

function loadSettings(storage: Storage | undefined): RagSettings {
  if (!storage) return { autoInject: true, embeddingModel: DEFAULT_RAG_EMBEDDING_MODEL };
  try {
    const raw = storage.getItem(RAG_SETTINGS_STORAGE_KEY);
    if (!raw) return { autoInject: true, embeddingModel: DEFAULT_RAG_EMBEDDING_MODEL };
    const parsed = JSON.parse(raw) as Partial<RagSettings>;
    return {
      autoInject: parsed.autoInject !== false,
      embeddingModel: typeof parsed.embeddingModel === 'string' && parsed.embeddingModel.trim()
        ? parsed.embeddingModel.trim()
        : DEFAULT_RAG_EMBEDDING_MODEL,
    };
  } catch {
    return { autoInject: true, embeddingModel: DEFAULT_RAG_EMBEDDING_MODEL };
  }
}

function saveSettings(settings: RagSettings, storage: Storage | undefined): void {
  storage?.setItem(RAG_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function sourceDigest(snapshot: RagSourceSnapshot): string {
  const threadBits = snapshot.threads.map(thread => [
    thread.id,
    thread.updatedAt,
    thread.deletedAt ?? '',
    thread.messages.length,
    thread.messages.map(message => `${message.id}:${message.createdAt}:${messageText(message).length}`).join(','),
  ].join('|')).join(';');
  const noteBits = snapshot.notes.map(note => `${note.id}:${note.updatedAt}:${note.title.length}:${note.body.length}`).join(';');
  return `${threadBits}\n${noteBits}\n${snapshot.facts.join('\n')}`;
}
