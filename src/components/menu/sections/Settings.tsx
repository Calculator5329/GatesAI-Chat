// Renders the Settings menu section and the controls for its store-backed workflow.
// Called by GatesMenu; depends on MobX stores, bridge services, and shared UI primitives.
// Invariant: menu components present state and delegate side effects to stores/services.
import { useRef, useState, type ChangeEvent } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import type { ThemeMode } from '../../../core/types';
import { UI_PACKS, uiPackMeta, type UiPackKey } from '../../../core/uiPacks';
import { Button, Input, SegmentedControl, SettingsRow, Toggle } from '../../ui';
import { useRootStore, useUiStore } from '../../../stores/context';
import { isWebLite } from '../../../core/runtime';
import { DEFAULT_GLOBAL_SUMMON_CHORD } from '../../../core/shortcutChord';
import { ChordRecorder } from './ChordRecorder';
import { ProviderCard, OPENROUTER_PROVIDER_INFO } from './api/ProviderCard';
import { SearchCard } from './api/ApiSection';

type DataImportMode = 'merge' | 'replace';

export const SettingsSection = observer(function SettingsSection() {
  // Web Lite has no Models tab, so the provider keys live here, right after
  // the theme. Presentation packs and thread titling are desktop-only knobs
  // in the browser build: nothing in Web Lite reads them.
  if (isWebLite()) {
    return (
      <div className="settings-page">
        <h1 style={tokens.h1}>Settings</h1>
        <div className="settings-page__kicker" style={tokens.kicker}>theme · keys · app data · danger zone</div>

        <ThemeBlock />
        <KeysBlock />
        <ExportImportBlock />
        <DangerZone />
      </div>
    );
  }
  return (
    <div className="settings-page">
      <h1 style={tokens.h1}>Settings</h1>
      <div className="settings-page__kicker" style={tokens.kicker}>theme · app data · danger zone</div>

      <ThemeBlock />
      <UiPackBlock />
      <ConversationBlock />
      <DesktopBlock />
      <ExportImportBlock />
      <DangerZone />
    </div>
  );
});

const KeysBlock = observer(function KeysBlock() {
  const root = useRootStore();
  return (
    <div className="settings-section settings-keys" style={{ ...tokens.section, marginBottom: 28 }}>
      <div className="settings-section-title" style={tokens.sectionTitle}>Keys</div>
      <div className="settings-muted-copy" style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.55 }}>
        Chat uses your own OpenRouter key; web answers use Brave Search. Keys stay in this
        browser and are sent only as the request header each provider requires.
      </div>
      <ProviderCard info={OPENROUTER_PROVIDER_INFO} providers={root.providers} />
      <SearchCard />
    </div>
  );
});

const ConversationBlock = observer(function ConversationBlock() {
  const ui = useUiStore();
  return (
    <div className="settings-section settings-conversation" style={{ ...tokens.section, marginBottom: 28 }}>
      <div className="settings-section-title" style={tokens.sectionTitle}>Conversations</div>
      <SettingsRow label="Automatic thread titles" last>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <Toggle testId="settings.preferences.toggle" label="Automatic thread titles" on={ui.autoNamingEnabled} onChange={ui.setAutoNamingEnabled} />
          <div className="settings-row-detail" style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.45, maxWidth: 520 }}>
            Generate a short title after the first response. Turn this off to keep the current or default title.
          </div>
        </div>
      </SettingsRow>
    </div>
  );
});

const THEME_OPTIONS = ['dark', 'light', 'system'] as const satisfies readonly ThemeMode[];

const ThemeBlock = observer(function ThemeBlock() {
  const ui = useUiStore();
  return (
    <div className="settings-section settings-theme" style={{ ...tokens.section, marginBottom: 28 }}>
      <div className="settings-section-title" style={tokens.sectionTitle}>Theme</div>
      <SettingsRow label="Color mode" last>
        <SegmentedControl
          identityKey="theme"
          options={THEME_OPTIONS}
          value={ui.theme}
          onChange={ui.setTheme}
          labels={{ dark: 'Dark', light: 'Light', system: 'System' }}
        />
      </SettingsRow>
    </div>
  );
});

const PACK_OPTIONS = UI_PACKS.map(pack => pack.key);
const PACK_LABELS = Object.fromEntries(UI_PACKS.map(pack => [pack.key, pack.name])) as Record<UiPackKey, string>;

/**
 * The before/after switcher. Packs are interchangeable presentations of the
 * same data, so this is a live toggle with no reload and no migration —
 * adding a future pack means one entry in `core/uiPacks.ts`.
 */
const UiPackBlock = observer(function UiPackBlock() {
  const ui = useUiStore();
  return (
    <div className="settings-section settings-ui-pack" style={{ ...tokens.section, marginBottom: 28 }}>
      <div className="settings-section-title" style={tokens.sectionTitle}>Interface pack</div>
      <SettingsRow label="Presentation" last>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <SegmentedControl
            identityKey="ui-pack"
            options={PACK_OPTIONS}
            value={ui.uiPack}
            onChange={ui.setUiPack}
            labels={PACK_LABELS}
          />
          <div className="settings-row-detail" style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.45, maxWidth: 520 }}>
            {uiPackMeta(ui.uiPack).description} Switching is instant and changes presentation only;
            your threads, settings, and tools are identical in every pack.
          </div>
        </div>
      </SettingsRow>
    </div>
  );
});

const DesktopBlock = observer(function DesktopBlock() {
  const ui = useUiStore();
  if (isWebLite()) return null;
  const unavailable = ui.globalSummonEnabled && !!ui.globalShortcutUnavailableReason;

  return (
    <div className="settings-section settings-desktop" style={{ ...tokens.section, marginBottom: 28 }}>
      <div className="settings-section-title" style={tokens.sectionTitle}>Desktop</div>
      <SettingsRow label="Global summon">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <Toggle testId="settings.preferences.global-summon" label="Global summon" on={ui.globalSummonEnabled} onChange={ui.setGlobalSummonEnabled} />
          <div className="settings-row-detail" style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.45, maxWidth: 520 }}>
            Show, focus, or hide GatesAI from anywhere.
          </div>
          {unavailable && (
            <div style={{ fontSize: 12, color: 'var(--danger)', lineHeight: 1.45, maxWidth: 520 }}>
              Shortcut unavailable - in use by another app.
            </div>
          )}
        </div>
      </SettingsRow>
      <SettingsRow label="Summon shortcut">
        <ChordRecorder
          value={ui.globalSummonChord}
          disabled={!ui.globalSummonEnabled}
          onChange={ui.setGlobalSummonChord}
          onReset={() => ui.setGlobalSummonChord(DEFAULT_GLOBAL_SUMMON_CHORD)}
        />
      </SettingsRow>
      <SettingsRow label="Close button hides to tray" last>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <Toggle testId="settings.preferences.close-hides-to-tray" label="Close button hides to tray" on={ui.closeButtonHidesToTray} onChange={ui.setCloseButtonHidesToTray} />
          <div className="settings-row-detail" style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.45, maxWidth: 520 }}>
            Quit from the tray menu still exits GatesAI completely.
          </div>
        </div>
      </SettingsRow>
    </div>
  );
});

const ExportImportBlock = observer(function ExportImportBlock() {
  const root = useRootStore();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [mode, setMode] = useState<DataImportMode>('merge');
  const [replaceConfirm, setReplaceConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [statusKind, setStatusKind] = useState<'ok' | 'error'>('ok');
  const replaceReady = mode === 'merge' || replaceConfirm === root.replaceImportConfirmation;

  const setResult = (message: string, kind: 'ok' | 'error' = 'ok'): void => {
    setStatus(message);
    setStatusKind(kind);
  };

  const handleExport = (): void => {
    try {
      root.downloadDataExport();
      setResult('Export downloaded.');
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const handleImportFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy(true);
    setStatus(null);
    try {
      const text = await file.text();
      const result = root.importDataFromJson(text, mode);
      setResult(root.formatDataImportResult(result));
      setReplaceConfirm('');
    } catch (err) {
      setResult(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-section settings-export-import" style={{ ...tokens.section, marginBottom: 28 }}>
      <div className="settings-section-title" style={tokens.sectionTitle}>Export & import</div>
      <div className="settings-muted-copy" style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.55 }}>
        One JSON file holds conversations, memories, notes, summaries, the system prompt and UI preferences.
      </div>
      {status && (
        <div role="status" style={{ fontSize: 12, color: statusKind === 'error' ? 'var(--danger)' : 'var(--accent)', marginBottom: 10 }}>
          {status}
        </div>
      )}
      <div className="settings-action-list">
        <div className="settings-action-row">
          <div className="settings-action-row__text">
            <div className="settings-action-row__title">Export</div>
            <div className="settings-row-detail" style={detailStyle}>Download everything this app has saved as one JSON file.</div>
          </div>
          <Button data-testid="settings.preferences.export-json" variant="accent" onClick={handleExport}>Export JSON</Button>
        </div>
        <div className="settings-action-row">
          <div className="settings-action-row__text">
            <div className="settings-action-row__title">Import</div>
            <div className="settings-row-detail" style={detailStyle}>
              {mode === 'merge'
                ? 'Merge keeps what is here and adds what the file has. Existing threads win on duplicate IDs.'
                : 'Replace wipes the current app state first, then loads the file.'}
            </div>
            <div className="settings-action-row__options" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
              {(['merge', 'replace'] as const).map(value => (
                <label key={value} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-dim)' }}>
                  <input data-testid={`settings.preferences.import-mode-${value}`}
                    type="radio"
                    name="settings-data-import-mode"
                    value={value}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  {value === 'merge' ? 'Merge' : 'Replace'}
                </label>
              ))}
            </div>
            {mode === 'replace' && (
              <div className="settings-action-row__confirm" style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                <div style={{ fontSize: 12, color: replaceReady ? 'var(--text-dim)' : 'var(--danger)', lineHeight: 1.45 }}>
                  Type <code style={tokens.mono}>{root.replaceImportConfirmation}</code> to confirm the wipe.
                </div>
                <Input data-testid="settings.preferences.input"
                  value={replaceConfirm}
                  onChange={event => setReplaceConfirm(event.currentTarget.value)}
                  placeholder={root.replaceImportConfirmation}
                  style={{ maxWidth: 320 }}
                />
              </div>
            )}
          </div>
          <Button data-testid="settings.preferences.button"
            disabled={busy || !replaceReady}
            variant={mode === 'replace' ? 'danger' : 'default'}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Importing...' : 'Choose JSON'}
          </Button>
          <input data-testid="settings.preferences.file-input"
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            onChange={event => { void handleImportFile(event); }}
            style={{ display: 'none' }}
          />
        </div>
      </div>
    </div>
  );
});

const DangerZone = observer(function DangerZone() {
  const root = useRootStore();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const visibleCount = root.chat.visibleThreads.length;
  const memoryCount = root.profile.facts.length;
  const hasProviderKeys = !!root.providers.getConfig('openrouter').apiKey || !!root.ollama.config.apiKey;

  const runAction = async (id: string, action: () => void | Promise<void>, done: string): Promise<void> => {
    setBusy(id);
    setStatus(null);
    try {
      await action();
      setStatus(done);
      setConfirming(null);
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const actions = [
    {
      id: 'threads',
      label: 'Delete all threads',
      detail: `Removes ${visibleCount} visible thread${visibleCount === 1 ? '' : 's'} and starts one fresh empty thread.`,
      confirm: `Delete ${visibleCount} thread${visibleCount === 1 ? '' : 's'}? This cannot be undone.`,
      done: 'Threads cleared.',
      run: () => root.chat.clearAllThreads(),
    },
    {
      id: 'memories',
      label: 'Delete memories',
      detail: `Removes ${memoryCount} saved user memor${memoryCount === 1 ? 'y' : 'ies'} from the Agent profile.`,
      confirm: `Delete all ${memoryCount} memor${memoryCount === 1 ? 'y' : 'ies'}?`,
      done: 'Memories cleared.',
      disabled: memoryCount === 0,
      run: () => root.profile.clearFacts(),
    },
    {
      id: 'provider-keys',
      label: 'Remove provider keys',
      detail: 'Clears saved OpenRouter and Ollama keys from local app storage.',
      confirm: 'Remove saved provider API keys from this app?',
      done: 'Provider keys removed.',
      disabled: !hasProviderKeys,
      run: () => {
        root.providers.remove('openrouter');
        root.ollama.setKey('');
      },
    },
  ];

  return (
    <div className="settings-section settings-danger-zone" style={tokens.section}>
      <div className="settings-section-title" style={tokens.sectionTitle}>Danger zone</div>
      <div className="settings-muted-copy" style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.55 }}>
        These actions only affect local GatesAI data. Workspace files are never touched from here.
      </div>
      {status && (
        <div role="status" style={{ fontSize: 12, color: status.includes('offline') || status.includes('Error') ? 'var(--danger)' : 'var(--accent)', marginBottom: 10 }}>
          {status}
        </div>
      )}
      <div className="settings-action-list settings-action-list--danger">
        {actions.map(action => (
          <div key={action.id} className="settings-action-row" data-confirming={confirming === action.id || undefined}>
            <div className="settings-action-row__text">
              <div className="settings-action-row__title">{action.label}</div>
              <div className="settings-row-detail" style={detailStyle}>{action.detail}</div>
              {confirming === action.id && (
                <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 6, lineHeight: 1.45 }}>{action.confirm}</div>
              )}
            </div>
            {confirming === action.id ? (
              <div className="settings-action-controls" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                <Button data-testid="settings.preferences.cancel" disabled={busy === action.id} onClick={() => setConfirming(null)}>Cancel</Button>
                <Button data-testid="settings.preferences.run"
                  variant="danger"
                  disabled={busy === action.id}
                  onClick={() => { void runAction(action.id, action.run, action.done); }}
                >
                  {busy === action.id ? 'Working...' : 'Confirm'}
                </Button>
              </div>
            ) : (
              <Button data-testid={`settings.preferences.delete-${action.id}`}
                variant="danger"
                disabled={action.disabled || !!busy}
                onClick={() => setConfirming(action.id)}
              >
                Delete...
              </Button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
});

const detailStyle = { fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.45, maxWidth: 520 } as const;
