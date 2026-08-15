// Single source for the full-screen menu's section order and labels.
// Lives in core because two layers need it and neither may import the other:
// components/menu attaches the lazy components, and the editorial sidebar
// reads the label for its mobile title. Keeping it here is what stopped the
// two files from drifting into different orders with duplicated strings.
import type { MenuSectionKey } from './types';

/**
 * Settings leads because the brand wordmark, which is the menu's entry point,
 * opens to it by default. The landing section should be the leftmost tab.
 */
export const MENU_SECTION_ORDER: readonly MenuSectionKey[] = ['settings', 'models', 'agent'] as const;

export const MENU_SECTION_LABELS: Record<MenuSectionKey, string> = {
  settings: 'Settings',
  models: 'Models',
  agent: 'Agent',
};
