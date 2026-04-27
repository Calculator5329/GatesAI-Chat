import type { ComponentType } from 'react';
import { observer } from 'mobx-react-lite';
import type { MenuSectionKey } from '../../core/types';
import { useRouterStore } from '../../stores/context';
import { ProfileSection } from './sections/Profile';
import { AgentSection } from './sections/Agent';
import { SettingsSection } from './sections/Settings';
import { UsageSection } from './sections/Usage';
import { ApiSection } from './sections/Api';
import { LocalSection } from './sections/Local';
import { AppearanceSection } from './sections/Appearance';
import { WorkspaceSection } from './sections/Workspace';

interface MenuSectionDef {
  key: MenuSectionKey;
  label: string;
  component: ComponentType;
}

const SECTIONS: MenuSectionDef[] = [
  { key: 'profile',    label: 'Profile',    component: ProfileSection },
  { key: 'agent',      label: 'Agent',      component: AgentSection },
  { key: 'workspace',  label: 'Workspace',  component: WorkspaceSection },
  { key: 'settings',   label: 'Settings',   component: SettingsSection },
  { key: 'usage',      label: 'Usage',      component: UsageSection },
  { key: 'local',      label: 'Local',      component: LocalSection },
  { key: 'api',        label: 'API',        component: ApiSection },
  { key: 'appearance', label: 'Appearance', component: AppearanceSection },
];

export const GatesMenu = observer(function GatesMenu() {
  const router = useRouterStore();
  const ActiveSection = SECTIONS.find(s => s.key === router.menuSection)?.component ?? ProfileSection;

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0,
      background: 'var(--bg)', color: 'var(--text)',
      fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
      animation: 'fadeIn 0.18s ease',
    }}>
      <div style={{
        display: 'flex', alignItems: 'flex-end', gap: 2,
        padding: '22px 56px 0',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto',
      }}>
        {SECTIONS.map(s => {
          const active = router.menuSection === s.key;
          return (
            <div
              key={s.key}
              onClick={() => router.goMenu(s.key)}
              style={{
                padding: '11px 18px 12px',
                fontSize: 13,
                color: active ? 'var(--text)' : 'var(--text-dim)',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {s.label}
            </div>
          );
        })}
      </div>
      <div style={{ flex: 1, overflowY: 'auto', padding: '32px 56px 60px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <ActiveSection />
        </div>
      </div>
    </div>
  );
});
