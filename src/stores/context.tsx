import { createContext, useContext, type ReactNode } from 'react';
import type { RootStore } from './RootStore';
import type { ChatStore } from './ChatStore';
import type { UiStore } from './UiStore';
import type { ProviderStore } from './ProviderStore';
import type { RouterStore } from './RouterStore';
import type { ModelRegistry } from './ModelRegistry';
import type { OpenRouterStore } from './OpenRouterStore';
import type { UserProfileStore } from './UserProfileStore';
import type { BridgeStore } from './BridgeStore';
import type { ExecStreamStore } from './ExecStreamStore';
import type { ImageGenStore } from './ImageGenStore';
import type { OllamaStore } from './OllamaStore';
import type { LocalRuntimeStore } from './LocalRuntimeStore';

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

export function useExecStreamStore(): ExecStreamStore {
  return useRootStore().execStream;
}

export function useImageGenStore(): ImageGenStore {
  return useRootStore().imageGen;
}

export function useOllamaStore(): OllamaStore {
  return useRootStore().ollama;
}

export function useLocalRuntimeStore(): LocalRuntimeStore {
  return useRootStore().localRuntime;
}
