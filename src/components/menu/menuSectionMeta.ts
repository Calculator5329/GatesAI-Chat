import type { ComponentType } from 'react';
import type { MenuSectionKey } from '../../core/types';
import { AgentSection } from './sections/Agent';
import { WorkspaceSection } from './sections/Workspace';
import { SettingsSection } from './sections/Settings';
import { LocalSection } from './sections/Local';
import { ApiSection } from './sections/api/ApiSection';
import { GallerySection } from './sections/Gallery';

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
