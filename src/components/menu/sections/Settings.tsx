import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { Button, Card, SettingsRow } from '../../ui';
import { useRootStore, useRouterStore } from '../../../stores/context';
import { isWebLite } from '../../../services/system/runtime';
import {
  clearLocalDataExceptCredentials,
  formatBytes,
  readLocalDataUsage,
} from '../../../services/storage/webLiteLocalData';

export const SettingsSection = observer(function SettingsSection() {
  const router = useRouterStore();
  return (
    <div className="settings-page">
      <h1 style={tokens.h1}>Settings</h1>
      <div style={tokens.kicker}>app preferences · danger zone</div>

      <div className="settings-quick-actions">
        <button type="button" onClick={() => router.goMenu('models')}>API keys</button>
        <button type="button" onClick={() => router.goMenu('local')}>Local runtimes</button>
        <button type="button" onClick={() => router.goMenu('workspace')}>Workspace</button>
        <button type="button" onClick={() => router.goMenu('gallery')}>Gallery</button>
      </div>

      <Card className="settings-intro-card" style={{ padding: '14px 18px', marginBottom: 20 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          Cloud model keys, catalog controls, and OpenRouter image generation are under{' '}
          <strong style={{ color: 'var(--text)' }}>Models</strong>. Installed runtimes live under{' '}
          <strong style={{ color: 'var(--text)' }}>Local</strong>. This page keeps reset actions in one place.
        </div>
      </Card>

      <WebLiteBrowserData />
      <DangerZone />
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

  const resetWorkspaceFolder = async (path: string, children: string[] = []): Promise<void> => {
    if (!root.bridge.isOnline) throw new Error('Bridge is offline.');
    try {
      await root.bridge.client.request('fs.delete', { path });
    } catch {
      // Missing folder is fine; the mkdir below gives us the desired end state.
    }
    await root.bridge.client.request('fs.mkdir', { path });
    for (const child of children) {
      await root.bridge.client.request('fs.mkdir', { path: child });
    }
  };

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
      run: () => resetWorkspaceFolder('/workspace/attachments'),
    },
    {
      id: 'workspace-artifacts',
      label: 'Delete workspace artifacts',
      detail: 'Deletes generated outputs under /workspace/artifacts, including images, reports, data, and exports.',
      confirm: 'Delete every generated artifact under /workspace/artifacts?',
      done: 'Workspace artifacts deleted.',
      disabled: !root.bridge.isOnline,
      run: async () => {
        await resetWorkspaceFolder('/workspace/artifacts', [
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
  const [usage, setUsage] = useState(() => readLocalDataUsage());
  const [confirming, setConfirming] = useState(false);
  const [cleared, setCleared] = useState(false);
  if (!isWebLite()) return null;

  const total = usage.reduce((sum, slot) => sum + slot.bytes, 0);
  const keySlot = usage.find(slot => slot.credential);
  const nonCredentialSlots = usage.filter(slot => !slot.credential && slot.present);

  const clear = (): void => {
    clearLocalDataExceptCredentials();
    const next = readLocalDataUsage();
    setUsage(next);
    setConfirming(false);
    setCleared(true);
  };

  return (
    <div className="settings-section settings-browser-data" style={{ ...tokens.section, marginBottom: 28 }}>
      <div className="settings-section-title" style={tokens.sectionTitle}>Web Lite browser data</div>
      <Card className="settings-browser-card" style={{ padding: '14px 18px' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          Conversations, memories, notes, preferences, model catalog cache, and image history stay in this browser's
          <code style={{ ...tokens.mono, margin: '0 4px' }}>localStorage</code>.
          Firebase Hosting only serves the static app; it does not receive this local app data.
        </div>
        <div className="settings-data-summary" style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, marginTop: 12, fontSize: 12 }}>
          <div style={{ color: 'var(--text-dim)' }}>Tracked local data</div>
          <div style={{ ...tokens.mono, color: 'var(--text-faint)' }}>{formatBytes(total)}</div>
          <div style={{ color: 'var(--text-dim)' }}>Provider key slot</div>
          <div style={{ ...tokens.mono, color: keySlot?.present ? 'var(--accent)' : 'var(--text-faint)' }}>
            {keySlot?.present ? 'present' : 'empty'}
          </div>
        </div>
        <div className="settings-data-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
          {usage.filter(slot => slot.present).map(slot => (
            <span
              key={slot.key}
              title={slot.key}
              style={{
                ...tokens.mono,
                fontSize: 10.5,
                color: slot.credential ? 'var(--accent)' : 'var(--text-faint)',
                border: '1px solid var(--border)',
                borderRadius: 999,
                padding: '3px 7px',
                background: 'color-mix(in srgb, var(--panel) 80%, transparent)',
              }}
            >
              {slot.label} · {formatBytes(slot.bytes)}
            </span>
          ))}
        </div>
        {cleared && (
          <div style={{ marginTop: 12, color: 'var(--accent)', fontSize: 12 }}>
            Browser cache cleared. Refresh to boot into a completely clean local state.
          </div>
        )}
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
