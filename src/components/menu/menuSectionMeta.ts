import type { ComponentType } from 'react';
import type { MenuSectionKey } from '../../core/types';
import { ProfileSection } from './sections/Profile';
import { AgentSection } from './sections/Agent';
import { WorkspaceSection } from './sections/Workspace';
import { SettingsSection } from './sections/Settings';
import { UsageSection } from './sections/Usage';
import { LocalSection } from './sections/Local';
import { ApiSection } from './sections/Api';
import { GallerySection } from './sections/Gallery';
import { AppearanceSection } from './sections/Appearance';

export interface MenuSectionMeta {
  key: MenuSectionKey;
  label: string;
  component: ComponentType;
  supported: boolean;
  badge?: 'Coming soon';
}

export const MENU_SECTIONS: MenuSectionMeta[] = [
  { key: 'profile',    label: 'Profile',    component: ProfileSection,    supported: false, badge: 'Coming soon' },
  { key: 'agent',      label: 'Agent',      component: AgentSection,      supported: false, badge: 'Coming soon' },
  { key: 'workspace',  label: 'Workspace',  component: WorkspaceSection,  supported: true },
  { key: 'settings',   label: 'Settings',   component: SettingsSection,   supported: true },
  { key: 'usage',      label: 'Usage',      component: UsageSection,      supported: false, badge: 'Coming soon' },
  { key: 'local',      label: 'Local',      component: LocalSection,      supported: true },
  { key: 'api',        label: 'API',        component: ApiSection,        supported: true },
  { key: 'gallery',    label: 'Gallery',    component: GallerySection,    supported: true },
  { key: 'appearance', label: 'Appearance', component: AppearanceSection, supported: true },
];
