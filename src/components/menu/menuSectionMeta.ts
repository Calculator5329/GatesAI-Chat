// Coordinates the left menu surface and section metadata used by the app shell.
// Called by App and sidebar navigation; depends on section keys, lazy components, and support flags.
// Invariant: every routed section key maps to exactly one supported component or fallback.
import { lazy, type ComponentType } from 'react';
import type { MenuSectionKey } from '../../core/types';

const AgentSection = lazy(() => import('./sections/Agent').then(m => ({ default: m.AgentSection })));
const ApiSection = lazy(() => import('./sections/api/ApiSection').then(m => ({ default: m.ApiSection })));
const LocalSection = lazy(() => import('./sections/Local').then(m => ({ default: m.LocalSection })));
const WorkspaceSection = lazy(() => import('./sections/Workspace').then(m => ({ default: m.WorkspaceSection })));
const GallerySection = lazy(() => import('./sections/Gallery').then(m => ({ default: m.GallerySection })));
const SettingsSection = lazy(() => import('./sections/Settings').then(m => ({ default: m.SettingsSection })));

export interface MenuSectionMeta {
  key: MenuSectionKey;
  label: string;
  component: ComponentType;
  supported: boolean;
  badge?: 'Coming soon';
}

export const MENU_SECTIONS: MenuSectionMeta[] = [
  { key: 'agent',      label: 'Agent',      component: AgentSection,      supported: true },
  { key: 'models',     label: 'Models',     component: ApiSection,        supported: true },
  { key: 'local',      label: 'Local',      component: LocalSection,      supported: true },
  { key: 'workspace',  label: 'Workspace',  component: WorkspaceSection,  supported: true },
  { key: 'gallery',    label: 'Gallery',    component: GallerySection,    supported: true },
  { key: 'settings',   label: 'Settings',   component: SettingsSection,   supported: true },
];
