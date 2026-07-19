// Coordinates the left menu surface and section metadata used by the app shell.
// Called by App and sidebar navigation; depends on section keys, lazy components, and support flags.
// Invariant: every routed section key maps to exactly one supported component or fallback.
import { lazy, type ComponentType } from 'react';
import type { MenuSectionKey } from '../../core/types';

const AgentSection = lazy(() => import('./sections/Agent').then(m => ({ default: m.AgentSection })));
const ApiSection = lazy(() => import('./sections/api/ApiSection').then(m => ({ default: m.ApiSection })));
const SettingsSection = lazy(() => import('./sections/Settings').then(m => ({ default: m.SettingsSection })));

export interface MenuSectionMeta {
  key: MenuSectionKey;
  label: string;
  component: ComponentType;
  supported: boolean;
  badge?: 'Coming soon';
}

// Settings leads because the brand wordmark (the menu's entry point) opens to
// it by default — the landing section should be the first, leftmost tab.
export const MENU_SECTIONS: MenuSectionMeta[] = [
  { key: 'settings', label: 'Settings', component: SettingsSection, supported: true },
  { key: 'models',   label: 'Models',   component: ApiSection,      supported: true },
  { key: 'agent',    label: 'Agent',    component: AgentSection,    supported: true },
];
