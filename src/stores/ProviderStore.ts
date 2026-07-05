// Owns observable ProviderStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { autorun, makeAutoObservable, reaction, toJS } from 'mobx';
import type { ProviderConfig, ProviderConfigs, ProviderId } from '../core/llm';
import { LlmRouter } from '../services/llm/router';
import { loadProviderConfigs, saveProviderConfigs } from '../services/providerStorage';
import { normalizeOpenAiCompatBaseUrl } from '../services/llm/openaiCompatCatalog';
import { deleteSecret, SECRET_NAMES, setSecret, usesTauriSecretBackend } from '../services/secretStorage';
import { logger } from '../services/diagnostics/logger';
import type { ModelRegistry } from './ModelRegistry';

type ProviderConfigOverlay = () => ProviderConfigs;

interface ProviderStoreOptions {
  autoPersist?: boolean;
  useKeychainSecrets?: boolean;
}

/**
 * Owns provider credentials (API keys, base URLs) and the LLM router that
 * dispatches requests. Persisted under `gatesai.providers.v1` separately
 * from chat data — keys are sensitive and shouldn't leak into exports.
 */
export class ProviderStore {
  configs: ProviderConfigs = {};
  readonly router: LlmRouter;
  private readonly overlayConfigs: ProviderConfigOverlay;
  private readonly useKeychainSecrets: boolean;
  private routerDisposer: (() => void) | null = null;
  private configPersistenceDisposer: (() => void) | null = null;
  private secretPersistenceDisposer: (() => void) | null = null;

  constructor(
    registry: ModelRegistry,
    overlayConfigs: ProviderConfigOverlay = () => ({}),
    options: ProviderStoreOptions = {},
  ) {
    this.configs = loadProviderConfigs();
    this.overlayConfigs = overlayConfigs;
    this.useKeychainSecrets = options.useKeychainSecrets ?? usesTauriSecretBackend();
    this.router = new LlmRouter(registry, this.effectiveConfigs);
    makeAutoObservable<this,
      'router'
      | 'overlayConfigs'
      | 'useKeychainSecrets'
      | 'routerDisposer'
      | 'configPersistenceDisposer'
      | 'secretPersistenceDisposer'
    >(this, {
      router: false,
      overlayConfigs: false,
      useKeychainSecrets: false,
      routerDisposer: false,
      configPersistenceDisposer: false,
      secretPersistenceDisposer: false,
    });

    this.routerDisposer = autorun(() => {
      toJS(this.configs);
      this.router.updateConfigs(this.effectiveConfigs);
    });

    if (options.autoPersist ?? true) this.startPersistence();
  }

  startPersistence(): void {
    if (this.configPersistenceDisposer || this.secretPersistenceDisposer) return;
    this.configPersistenceDisposer = autorun(() => {
      const snap = toJS(this.configs);
      saveProviderConfigs(providerConfigsForLocalPersistence(snap, this.useKeychainSecrets));
    });
    this.secretPersistenceDisposer = reaction(
      () => ({
        openrouter: this.configs.openrouter?.apiKey ?? '',
        openAiCompat: this.configs['openai-compat']?.apiKey ?? '',
      }),
      keys => {
        persistSecretValue(SECRET_NAMES.openrouterApiKey, keys.openrouter, 'OpenRouter API key');
        persistSecretValue(SECRET_NAMES.openAiCompatApiKey, keys.openAiCompat, 'custom endpoint API key');
      },
      { fireImmediately: false },
    );
  }

  dispose(): void {
    this.secretPersistenceDisposer?.();
    this.configPersistenceDisposer?.();
    this.routerDisposer?.();
    this.secretPersistenceDisposer = null;
    this.configPersistenceDisposer = null;
    this.routerDisposer = null;
  }

  hydrateOpenRouterKey(apiKey: string | null | undefined): void {
    this.setKey('openrouter', apiKey ?? '');
  }

  hydrateOpenAiCompatKey(apiKey: string | null | undefined): void {
    this.setKey('openai-compat', apiKey ?? '');
  }

  get effectiveConfigs(): ProviderConfigs {
    return {
      ...this.configs,
      ...this.overlayConfigs(),
    };
  }

  getConfig(id: ProviderId): ProviderConfig {
    return this.effectiveConfigs[id] ?? {};
  }

  setKey(id: ProviderId, apiKey: string): void {
    const trimmed = apiKey.trim();
    const current = this.configs[id] ?? {};
    if (!trimmed) {
      const { apiKey: _, ...rest } = current;
      if (Object.keys(rest).length === 0) delete this.configs[id];
      else this.configs[id] = rest;
    } else {
      this.configs[id] = { ...current, apiKey: trimmed };
    }
  }

  setBaseUrl(id: ProviderId, baseUrl: string): void {
    const trimmed = id === 'openai-compat'
      ? normalizeOpenAiCompatBaseUrl(baseUrl)
      : baseUrl.trim();
    const current = this.configs[id] ?? {};
    if (!trimmed) {
      const { baseUrl: _, ...rest } = current;
      if (Object.keys(rest).length === 0) delete this.configs[id];
      else this.configs[id] = rest;
    } else {
      this.configs[id] = { ...current, baseUrl: trimmed };
    }
  }

  setLabel(id: ProviderId, label: string): void {
    const trimmed = label.trim();
    const current = this.configs[id] ?? {};
    if (!trimmed) {
      const { label: _, ...rest } = current;
      if (Object.keys(rest).length === 0) delete this.configs[id];
      else this.configs[id] = rest;
    } else {
      this.configs[id] = { ...current, label: trimmed };
    }
  }

  setAvailable(id: ProviderId, available: boolean): void {
    const current = this.configs[id] ?? {};
    this.configs[id] = { ...current, available };
  }

  remove(id: ProviderId): void {
    delete this.configs[id];
  }

  isConnected(id: ProviderId): boolean {
    void this.configs;
    void Object.keys(this.configs).length;
    void this.configs[id]?.apiKey;
    void this.configs[id]?.baseUrl;
    void this.configs[id]?.available;
    return this.router.get(id).ready();
  }

  /**
   * True iff at least one real provider is configured (has a key, or for
   * local, an explicit baseUrl). Backed by `LlmRouter.canRoute()`. The UI
   * uses this to gate sending — when false, there's no real backend to talk
   * to.
   */
  get hasUsableProvider(): boolean {
    // Touch configs and its keys so MobX tracks this getter as depending on
    // mutations to configs. The canonical authority is router.canRoute(), but
    // the router's mirror of configs is plain (non-observable) — kept in
    // sync by the autorun in this constructor. Reading just `this.configs`
    // would only subscribe to reassignment of the configs property itself;
    // we add/remove inner keys (`configs[id] = …`), so we must also subscribe
    // to the key set of the inner object. Without this, observer components
    // subscribed to hasUsableProvider would not re-render when the user adds
    // a key.
    void this.configs;
    void Object.keys(this.configs).length;
    for (const config of Object.values(this.configs)) {
      void config?.apiKey;
      void config?.baseUrl;
      void config?.available;
    }
    return this.router.canRoute();
  }
}

function providerConfigsForLocalPersistence(configs: ProviderConfigs, stripSecrets: boolean): ProviderConfigs {
  if (!stripSecrets) return configs;
  const next: ProviderConfigs = { ...configs };
  const openrouter = next.openrouter;
  if (openrouter?.apiKey) {
    const { apiKey: _, ...rest } = openrouter;
    if (Object.keys(rest).length > 0) next.openrouter = rest;
    else delete next.openrouter;
  }
  const openAiCompat = next['openai-compat'];
  if (openAiCompat?.apiKey) {
    const { apiKey: _, ...rest } = openAiCompat;
    if (Object.keys(rest).length > 0) next['openai-compat'] = rest;
    else delete next['openai-compat'];
  }
  return next;
}

function persistSecretValue(name: string, value: string, label: string): void {
  const op = value ? setSecret(name, value) : deleteSecret(name);
  void op.catch(err => logger.warn('persistence', `${label} persistence failed`, { err }));
}
