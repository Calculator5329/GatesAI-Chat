// Renders the Settings menu section and the controls for its store-backed workflow.
// Called by GatesMenu; depends on MobX stores, bridge services, and shared UI primitives.
// Invariant: menu components present state and delegate side effects to stores/services.
import { useRef, useState, type ChangeEvent } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { Button, Card, Input, SettingsRow } from '../../ui';
import { useRootStore, useRouterStore, useUiStore } from '../../../stores/context';
import { isWebLite } from '../../../core/runtime';

type DataImportMode = 'merge' | 'replace';

export const SettingsSection = observer(function SettingsSection() {
  const router = useRouterStore();
  const webLite = isWebLite();
  return (
    <div className="settings-page">
      <h1 style={tokens.h1}>Settings</h1>
      <div className="settings-page__kicker" style={tokens.kicker}>API key · app data · danger zone</div>

      <Card
        className="settings-apikey-card"
        style={{ padding: '16px 18px', marginTop: 8, marginBottom: 16, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>OpenRouter API key</div>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginTop: 3, lineHeight: 1.5, maxWidth: 480 }}>
            Your key unlocks cloud chat, vision, and image models. It's stored only in
            this {webLite ? 'browser' : 'app'} and sent directly to OpenRouter — never to us.
          </div>
        </div>
        <Button variant="accent" onClick={() => router.goMenu('models')}>Manage key</Button>
      </Card>

      <p className="settings-help-line" style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55, margin: '0 0 22px' }}>
        Model catalog and image generation live under{' '}
        <button type="button" className="settings-inline-link" onClick={() => router.goMenu('models')}>Models</button>; installed
        runtimes (Ollama, ComfyUI) under{' '}
        <button type="button" className="settings-inline-link" onClick={() => router.goMenu('local')}>Local</button>. This page keeps
        your app data and reset actions in one place.
      </p>

      <WebLiteBrowserData />
      <ExportImportBlock />
      <DangerZone />
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
      {status && (
        <div style={{ fontSize: 12, color: statusKind === 'error' ? '#ff7597' : 'var(--accent)', marginBottom: 8 }}>
          {status}
        </div>
      )}
      <SettingsRow label="Export app data">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
          <Button variant="accent" onClick={handleExport}>Export JSON</Button>
          <div className="settings-row-detail" style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.45, maxWidth: 520 }}>
            Saves conversations, memories, notes, summaries, system prompt, and UI preferences.
          </div>
        </div>
      </SettingsRow>
      <SettingsRow label="Import mode">
        <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
          {(['merge', 'replace'] as const).map(value => (
            <label key={value} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--text-dim)' }}>
              <input
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
      </SettingsRow>
      {mode === 'replace' && (
        <SettingsRow label="Replace confirm">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
            <div style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.45 }}>
              Type <code style={tokens.mono}>{root.replaceImportConfirmation}</code>
            </div>
            <Input
              value={replaceConfirm}
              onChange={event => setReplaceConfirm(event.currentTarget.value)}
              placeholder={root.replaceImportConfirmation}
              style={{ maxWidth: 320 }}
            />
          </div>
        </SettingsRow>
      )}
      <SettingsRow label="Import file" last>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Button
            disabled={busy || !replaceReady}
            variant={mode === 'replace' ? 'danger' : 'default'}
            onClick={() => inputRef.current?.click()}
          >
            {busy ? 'Importing...' : 'Choose JSON'}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".json,application/json"
            onChange={event => { void handleImportFile(event); }}
            style={{ display: 'none' }}
          />
          {mode === 'merge' ? (
            <span style={{ fontSize: 12, color: 'var(--text-faint)' }}>Existing threads win on duplicate IDs.</span>
          ) : (
            <span style={{ fontSize: 12, color: replaceReady ? 'var(--text-faint)' : '#ff7597' }}>
              Existing app state will be replaced.
            </span>
          )}
        </div>
      </SettingsRow>
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
  const notesCount = root.notes.notes.length;
  const summaryCount = root.chat.threads.filter(t => t.summary?.trim() || t.threadContext?.trim()).length;
  const imageJobCount = root.imageJobs.history.length;
  const hasSystemPrompt = root.profile.defaultSystemPrompt.trim().length > 0;
  const hasProviderKeys = !!root.providers.getConfig('openrouter').apiKey || !!root.ollama.config.apiKey;
  const catalogCount = root.openrouter.count + root.ollama.count;

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
      id: 'system-prompt',
      label: 'Clear system prompt',
      detail: 'Removes the custom global instructions sent with every request.',
      confirm: 'Clear the custom system prompt?',
      done: 'System prompt cleared.',
      disabled: !hasSystemPrompt,
      run: () => root.profile.setDefaultSystemPrompt(''),
    },
    {
      id: 'notes',
      label: 'Delete long-form notes',
      detail: `Removes ${notesCount} note${notesCount === 1 ? '' : 's'} used by the notes tool. Workspace files are not touched.`,
      confirm: `Delete all ${notesCount} long-form note${notesCount === 1 ? '' : 's'}?`,
      done: 'Long-form notes cleared.',
      disabled: notesCount === 0,
      run: () => root.notes.clear(),
    },
    {
      id: 'thread-memory',
      label: 'Clear thread context',
      detail: `Removes summaries and per-thread context from ${summaryCount} thread${summaryCount === 1 ? '' : 's'} while keeping messages.`,
      confirm: 'Clear all thread summaries and per-thread context?',
      done: 'Thread context cleared.',
      disabled: summaryCount === 0,
      run: () => root.chat.clearThreadMemory(),
    },
    {
      id: 'image-history',
      label: 'Clear image history',
      detail: `Removes ${imageJobCount} gallery/history record${imageJobCount === 1 ? '' : 's'}. Image files on disk remain.`,
      confirm: 'Clear image generation history? Files in the workspace are not deleted.',
      done: 'Image history cleared.',
      disabled: imageJobCount === 0,
      run: () => root.imageJobs.clearHistory(),
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
    {
      id: 'catalogs',
      label: 'Clear model catalogs',
      detail: `Clears ${catalogCount} cached OpenRouter/Ollama model entr${catalogCount === 1 ? 'y' : 'ies'}. Keys and settings remain.`,
      confirm: 'Clear cached model catalogs?',
      done: 'Model catalogs cleared.',
      disabled: catalogCount === 0,
      run: () => {
        root.openrouter.clearCache();
        root.ollama.clearCatalog();
      },
    },
    {
      id: 'image-settings',
      label: 'Reset image settings',
      detail: 'Resets image_generate backend preferences and ComfyUI image options to defaults.',
      confirm: 'Reset image generation settings?',
      done: 'Image settings reset.',
      run: () => root.imageGen.reset(),
    },
    {
      id: 'local-runtimes',
      label: 'Reset local runtime settings',
      detail: 'Clears Ollama/ComfyUI paths, base URLs, auto-detect state, and selected vision model.',
      confirm: 'Reset local runtime settings? Running processes are not stopped.',
      done: 'Local runtime settings reset.',
      run: () => {
        root.localRuntime.resetConfig();
        root.ollama.clearCatalog();
      },
    },
    {
      id: 'workspace-attachments',
      label: 'Delete workspace uploads',
      detail: 'Deletes files under /workspace/attachments. Chat attachment references may no longer open.',
      confirm: 'Delete every file in /workspace/attachments?',
      done: 'Workspace uploads deleted.',
      disabled: !root.bridge.isOnline,
      run: () => root.bridge.resetWorkspaceDirectory('/workspace/attachments'),
    },
    {
      id: 'workspace-artifacts',
      label: 'Delete workspace artifacts',
      detail: 'Deletes generated outputs under /workspace/artifacts, including images, reports, data, and exports.',
      confirm: 'Delete every generated artifact under /workspace/artifacts?',
      done: 'Workspace artifacts deleted.',
      disabled: !root.bridge.isOnline,
      run: async () => {
        await root.bridge.resetWorkspaceDirectory('/workspace/artifacts', [
          '/workspace/artifacts/images',
          '/workspace/artifacts/images/api',
          '/workspace/artifacts/images/local',
          '/workspace/artifacts/data',
          '/workspace/artifacts/reports',
          '/workspace/artifacts/exports',
        ]);
        root.imageJobs.clearHistory();
      },
    },
  ];

  return (
    <div className="settings-section settings-danger-zone" style={tokens.section}>
      <div className="settings-section-title" style={tokens.sectionTitle}>Danger zone</div>
      <div className="settings-muted-copy" style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 12, lineHeight: 1.55 }}>
        App resets only affect local GatesAI data unless the row explicitly names a
        <code style={{ ...tokens.mono, margin: '0 4px' }}>/workspace</code>
        folder.
      </div>
      {status && (
        <div style={{ fontSize: 12, color: status.includes('offline') || status.includes('Error') ? '#ff7597' : 'var(--accent)', marginBottom: 8 }}>
          {status}
        </div>
      )}
      {actions.map((action, index) => (
        <SettingsRow key={action.id} label={action.label} last={index === actions.length - 1}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
            <div className="settings-row-detail" style={{ fontSize: 12, color: 'var(--text-faint)', lineHeight: 1.45, maxWidth: 520 }}>
              {action.detail}
            </div>
            {confirming === action.id ? (
              <div className="settings-action-controls" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>{action.confirm}</span>
                <Button
                  variant="danger"
                  disabled={busy === action.id}
                  onClick={() => { void runAction(action.id, action.run, action.done); }}
                >
                  {busy === action.id ? 'Working...' : 'Confirm'}
                </Button>
                <Button disabled={busy === action.id} onClick={() => setConfirming(null)}>Cancel</Button>
              </div>
            ) : (
              <Button
                variant="danger"
                disabled={action.disabled || !!busy}
                onClick={() => setConfirming(action.id)}
              >
                Delete...
              </Button>
            )}
          </div>
        </SettingsRow>
      ))}
    </div>
  );
});

function WebLiteBrowserData() {
  const ui = useUiStore();
  const [usage] = useState(() => ui.localDataUsage());
  const [confirming, setConfirming] = useState(false);
  if (!isWebLite()) return null;

  const total = usage.reduce((sum, slot) => sum + slot.bytes, 0);
  const nonCredentialSlots = usage.filter(slot => !slot.credential && slot.present);

  const clear = (): void => {
    ui.clearLocalDataExceptCredentials();
    window.location.reload();
  };

  return (
    <div className="settings-section settings-browser-data" style={{ ...tokens.section, marginBottom: 28 }}>
      <div className="settings-section-title" style={tokens.sectionTitle}>Your data is saved in this browser</div>
      <Card className="settings-browser-card" style={{ padding: '14px 18px' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          In Web Lite, your conversations, memories, notes, preferences, model catalog cache, and image history are saved
          locally in this browser's
          <code style={{ ...tokens.mono, margin: '0 4px' }}>localStorage</code>.
          Nothing is sent to a server — the host only serves the static app — so clearing this browser's data resets the app.
        </div>
        <div
          className="settings-data-summary"
          style={{
            marginTop: 14,
            border: '1px solid var(--border)',
            borderRadius: 9,
            background: 'color-mix(in srgb, var(--panel) 55%, transparent)',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '12px 14px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontSize: 12.5, color: 'var(--text)', fontWeight: 500 }}>Tracked local data</span>
            <span style={{ ...tokens.mono, fontSize: 15, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{ui.formatBytes(total)}</span>
          </div>
          {usage.filter(slot => slot.present).map(slot => (
            <div
              key={slot.key}
              title={slot.key}
              style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
                padding: '8px 14px',
                borderTop: '1px solid color-mix(in srgb, var(--border) 55%, transparent)',
                background: slot.credential ? 'color-mix(in srgb, var(--accent) 8%, transparent)' : 'transparent',
              }}
            >
              <span style={{ fontSize: 12, color: slot.credential ? 'var(--accent)' : 'var(--text-dim)' }}>
                {slot.label}{slot.credential ? ' (kept on clear)' : ''}
              </span>
              <span style={{ ...tokens.mono, fontSize: 11.5, color: 'var(--text-faint)', fontVariantNumeric: 'tabular-nums' }}>
                {ui.formatBytes(slot.bytes)}
              </span>
            </div>
          ))}
        </div>
        <div className="settings-action-controls" style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 8, marginTop: 14 }}>
          {confirming ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--text-dim)' }}>
                Clear {nonCredentialSlots.length} local data slot{nonCredentialSlots.length === 1 ? '' : 's'} but keep provider API keys?
              </span>
              <Button variant="danger" onClick={clear}>Confirm</Button>
              <Button onClick={() => setConfirming(false)}>Cancel</Button>
            </div>
          ) : (
            <Button
              variant="danger"
              disabled={nonCredentialSlots.length === 0}
              onClick={() => setConfirming(true)}
            >
              Clear browser cache
            </Button>
          )}
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.45 }}>
            This keeps <code style={tokens.mono}>gatesai.providers.v1</code>, so your OpenRouter key is not removed.
          </div>
        </div>
      </Card>
    </div>
  );
}
