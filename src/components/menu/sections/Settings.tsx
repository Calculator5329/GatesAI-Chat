import { tokens } from '../../../core/styleTokens';
import { SettingsRow, Toggle, Select, Button } from '../../ui';

const SHORTCUTS: Array<[string, string]> = [
  ['Open command palette', '⌘K'],
  ['New thread', '⌘N'],
  ['Open menu', '⌘,'],
  ['Focus composer', '⌘L'],
  ['Toggle sidebar', '⌘\\'],
];

export function SettingsSection() {
  return (
    <>
      <h1 style={tokens.h1}>Settings</h1>
      <div style={tokens.kicker}>preferences · behavior · shortcuts</div>

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>General</div>
        <SettingsRow label="Language"><span style={{ color: 'var(--text-dim)' }}>English (US)</span></SettingsRow>
        <SettingsRow label="Timezone"><span style={{ color: 'var(--text-dim)' }}>America/Los_Angeles (PDT)</span></SettingsRow>
        <SettingsRow label="Start screen">
          <Select defaultValue="last">
            <option value="last">Last open thread</option>
            <option>New thread</option>
            <option>Menu</option>
          </Select>
        </SettingsRow>
        <SettingsRow label="Send on Enter" last>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle on onChange={() => {}} />
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Shift+Enter for newline</span>
          </div>
        </SettingsRow>
      </div>

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>Privacy</div>
        <SettingsRow label="Share for improvement">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle on={false} onChange={() => {}} />
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Opt in to training</span>
          </div>
        </SettingsRow>
        <SettingsRow label="History retention">
          <Select defaultValue="forever">
            <option>30 days</option>
            <option>6 months</option>
            <option value="forever">Keep forever</option>
          </Select>
        </SettingsRow>
        <SettingsRow label="Data export" last>
          <Button>Export all threads (.zip)</Button>
        </SettingsRow>
      </div>

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>Shortcuts</div>
        {SHORTCUTS.map(([k, v], i) => {
          const last = i === SHORTCUTS.length - 1;
          return (
            <div
              key={k}
              style={{
                display: 'grid', gridTemplateColumns: '180px 1fr',
                gap: 24, padding: '12px 0',
                borderBottom: last ? 'none' : '1px solid var(--border)',
                alignItems: 'center',
              }}
            >
              <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>{k}</div>
              <div>
                <span style={{
                  ...tokens.mono, color: 'var(--text-dim)',
                  padding: '2px 7px', background: 'var(--panel)',
                  border: '1px solid var(--border)', borderRadius: 4,
                }}>{v}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>Danger zone</div>
        <SettingsRow label="Delete all threads">
          <Button variant="danger">Delete…</Button>
        </SettingsRow>
        <SettingsRow label="Delete account" last>
          <Button variant="danger">Delete account…</Button>
        </SettingsRow>
      </div>
    </>
  );
}
