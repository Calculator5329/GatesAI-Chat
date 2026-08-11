// Defines the UI-pack contract: which interchangeable presentation packs exist
// and which one is the default. Called by UiStore, the App shell, and every
// pack-aware component; depends on nothing.
// Invariant: `classic` is always present and is the fallback for any unknown
// persisted value, so a removed pack can never leave the app unrenderable.

/**
 * A UI pack swaps the *presentation* of chat primitives (loaders, thinking
 * traces, tool chips, cards, tables) without changing any behaviour, data, or
 * store contract. Packs are additive: adding one means adding a key here, a
 * `UI_PACKS` entry, and the components that read {@link UiPackKey}.
 *
 * - `classic` — the shipped GatesAI presentation. Never removed.
 * - `aurora`  — denser, card-led presentation in the style of contemporary
 *               AI-native component galleries.
 */
export type UiPackKey = 'classic' | 'aurora';

export interface UiPackMeta {
  key: UiPackKey;
  /** Short label for switchers. */
  name: string;
  /** One line explaining what changes when this pack is active. */
  description: string;
}

export const UI_PACKS: readonly UiPackMeta[] = [
  {
    key: 'classic',
    name: 'Classic',
    description: 'The original editorial presentation: quiet rows, prose first.',
  },
  {
    key: 'aurora',
    name: 'Aurora',
    description: 'Card-led AI-native presentation: chips, traces, and inline proposals.',
  },
];

export const DEFAULT_UI_PACK: UiPackKey = 'classic';

const PACK_KEYS = new Set<string>(UI_PACKS.map(pack => pack.key));

export function isUiPackKey(value: unknown): value is UiPackKey {
  return typeof value === 'string' && PACK_KEYS.has(value);
}

/** Normalizes any persisted or imported value to a pack that exists today. */
export function coerceUiPack(value: unknown): UiPackKey {
  return isUiPackKey(value) ? value : DEFAULT_UI_PACK;
}

export function uiPackMeta(key: UiPackKey): UiPackMeta {
  return UI_PACKS.find(pack => pack.key === key) ?? UI_PACKS[0];
}
