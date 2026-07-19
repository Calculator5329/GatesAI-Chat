// Owns observable context state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { RootStore } from './RootStore';
import type { ChatStore } from './ChatStore';
import type { DockStore } from './DockStore';
import type { ArtifactStore } from './ArtifactStore';
import type { UiStore } from './UiStore';
import type { ProviderStore } from './ProviderStore';
import type { RouterStore } from './RouterStore';
import type { ModelRegistry } from './ModelRegistry';
import type { OpenRouterStore } from './OpenRouterStore';
import type { UserProfileStore } from './UserProfileStore';
import type { BridgeStore } from './BridgeStore';
import type { ImageGenStore } from './ImageGenStore';
import type { ImageJobStore } from './ImageJobStore';
import type { TaskStore } from './TaskStore';
import type { OllamaStore } from './OllamaStore';
import type { LocalRuntimeStore } from './LocalRuntimeStore';
import type { SearchStore } from './SearchStore';
import type { McpStore } from './McpStore';
import type { OpenAiCompatEndpointStore } from './OpenAiCompatEndpointStore';
import type { SourceWorkspaceStore } from './SourceWorkspaceStore';
import type { RagStore } from '../services/rag/RagStore';
import type { SkillsStore } from './SkillsStore';
import type { WhatsNewStore } from './WhatsNewStore';
import type { UpdateStore } from './UpdateStore';
import type { OfflineLibraryStore } from './OfflineLibraryStore';

const StoreContext = createContext<RootStore | null>(null);

export function StoreProvider({ store, children }: { store: RootStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useRootStore(): RootStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useRootStore must be used within a StoreProvider');
  return store;
}

export function useChatStore(): ChatStore {
  return useRootStore().chat;
}

export function useUiStore(): UiStore {
  return useRootStore().ui;
}

export function useDockStore(): DockStore {
  return useRootStore().dock;
}

export function useArtifactStore(): ArtifactStore {
  return useRootStore().artifacts;
}

export function useProviderStore(): ProviderStore {
  return useRootStore().providers;
}

export function useRouterStore(): RouterStore {
  return useRootStore().router;
}

export function useModelRegistry(): ModelRegistry {
  return useRootStore().registry;
}

export function useOpenRouterStore(): OpenRouterStore {
  return useRootStore().openrouter;
}

export function useUserProfileStore(): UserProfileStore {
  return useRootStore().profile;
}

export function useBridgeStore(): BridgeStore {
  return useRootStore().bridge;
}

export function useImageGenStore(): ImageGenStore {
  return useRootStore().imageGen;
}

export function useImageJobStore(): ImageJobStore {
  return useRootStore().imageJobs;
}

export function useTaskStore(): TaskStore {
  return useRootStore().tasks;
}

export function useOllamaStore(): OllamaStore {
  return useRootStore().ollama;
}

export function useLocalRuntimeStore(): LocalRuntimeStore {
  return useRootStore().localRuntime;
}

export function useSearchStore(): SearchStore {
  return useRootStore().search;
}

export function useMcpStore(): McpStore {
  return useRootStore().mcp;
}

export function useOpenAiCompatEndpointStore(): OpenAiCompatEndpointStore {
  return useRootStore().openAiCompatEndpoint;
}

export function useSourceWorkspaceStore(): SourceWorkspaceStore {
  return useRootStore().sourceWorkspace;
}

export function useSkillsStore(): SkillsStore {
  return useRootStore().skills;
}
export function useRagStore(): RagStore {
  return useRootStore().rag;
}

export function useWhatsNewStore(): WhatsNewStore {
  return useRootStore().whatsNew;
}

export function useUpdateStore(): UpdateStore {
  return useRootStore().updates;
}

export function useOfflineLibraryStore(): OfflineLibraryStore {
  return useRootStore().offlineLibrary;
}

export interface EditorialStores {
  chat: ChatStore;
  ui: UiStore;
  router: RouterStore;
  bridge: BridgeStore;
  registry: ModelRegistry;
  providers: ProviderStore;
  imageJobs: ImageJobStore;
  localRuntime: LocalRuntimeStore;
  skills: SkillsStore;
  openrouter: OpenRouterStore;
  ollama: OllamaStore;
}

export function useEditorial(): EditorialStores {
  const chat = useChatStore();
  const ui = useUiStore();
  const router = useRouterStore();
  const bridge = useBridgeStore();
  const registry = useModelRegistry();
  const providers = useProviderStore();
  const imageJobs = useImageJobStore();
  const localRuntime = useLocalRuntimeStore();
  const skills = useSkillsStore();
  const openrouter = useOpenRouterStore();
  const ollama = useOllamaStore();

  return useMemo(() => ({
    chat,
    ui,
    router,
    bridge,
    registry,
    providers,
    imageJobs,
    localRuntime,
    skills,
    openrouter,
    ollama,
  }), [chat, ui, router, bridge, registry, providers, imageJobs, localRuntime, skills, openrouter, ollama]);
}
