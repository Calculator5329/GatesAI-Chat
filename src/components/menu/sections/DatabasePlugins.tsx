// Renders the Database Plugins menu section: an honest listing of installed
// local database plugins under the Offline Library / Local settings area.
// Presentational and prop-driven — it presents state and delegates every side
// effect (install/enable/remove) to callbacks a store facade supplies. Install
// and query are desktop-only; Web Lite shows an explainer (LF-1 pattern).
import { useState, type CSSProperties } from 'react';
import { tokens } from '../../../core/styleTokens';
import { hasDesktopRuntime } from '../../../core/runtime';
import { Button, Card, Input, Pill, Select, SettingsRow, Toggle } from '../../ui';
import { WebLiteNotice } from '../../ui/WebLiteNotice';

/** Presentational view of one installed plugin. Mirrors the service record's
 * user-visible fields without importing the service (UI stays above services). */
export interface DatabasePluginRow {
  id: string;
  version: string;
  description: string;
  publisher: string;
  enabled: boolean;
  dataPolicy: 'local_only' | 'cloud_allowed';
  capabilities: string[];
  datasets: Array<{ id: string; title: string }>;
}

export interface DatabasePluginsSectionProps {
  /** Installed plugins to list. Empty is a valid, honest state. */
  plugins: DatabasePluginRow[];
  /** Override desktop detection (tests). Defaults to hasDesktopRuntime(). */
  desktop?: boolean;
  busy?: boolean;
  error?: string | null;
  onToggleEnabled?: (id: string, enabled: boolean) => void;
  onRemove?: (id: string) => void;
  onInstall?: (source: { kind: 'file' | 'url'; location: string }) => void;
}

const metaText: CSSProperties = { color: 'var(--text-dim)', fontSize: 12.5, lineHeight: 1.5 };

export function DatabasePluginsSection({
  plugins,
  desktop,
  busy = false,
  error = null,
  onToggleEnabled,
  onRemove,
  onInstall,
}: DatabasePluginsSectionProps) {
  const isDesktop = desktop ?? hasDesktopRuntime();

  if (!isDesktop) {
    return (
      <>
        <h1 style={tokens.h1}>Database plugins</h1>
        <div style={tokens.kicker}>installable local data bundles</div>
        <WebLiteNotice show>
          <strong style={{ color: 'var(--text)' }}>Web Lite:</strong>{' '}
          Installing and querying downloadable database plugins is desktop-only. The desktop app
          stores bundles under an app-managed folder, verifies their integrity, and lets agents
          query them read-only with local citations. This browser build never installs, downloads,
          or queries a bundle.
        </WebLiteNotice>
      </>
    );
  }

  return (
    <>
      <h1 style={tokens.h1}>Database plugins</h1>
      <div style={tokens.kicker}>installed local data bundles · read-only · desktop</div>

      <InstallCard busy={busy} onInstall={onInstall} />

      {error ? (
        <Card style={{ marginTop: 14, padding: '12px 14px', borderColor: 'color-mix(in srgb, var(--danger, #d33) 40%, var(--border))' }}>
          <div style={{ ...metaText, color: 'var(--danger, #d33)' }} role="alert">{error}</div>
        </Card>
      ) : null}

      {plugins.length === 0 ? (
        <Card style={{ marginTop: 14, padding: '16px 18px' }}>
          <div style={metaText}>
            No database plugins installed. Install a <code>.gatesdb</code> bundle from a local file
            or an explicit HTTPS URL you trust. Bundles are read-only data — they cannot run code,
            reach the network, or issue arbitrary SQL.
          </div>
        </Card>
      ) : (
        <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {plugins.map(plugin => (
            <PluginCard
              key={plugin.id}
              plugin={plugin}
              busy={busy}
              onToggleEnabled={onToggleEnabled}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </>
  );
}

function InstallCard({ busy, onInstall }: { busy: boolean; onInstall?: DatabasePluginsSectionProps['onInstall'] }) {
  const [kind, setKind] = useState<'file' | 'url'>('file');
  const [location, setLocation] = useState('');
  const trimmed = location.trim();
  const canInstall = !busy && trimmed.length > 0 && (kind === 'file' || /^https:\/\//i.test(trimmed));

  return (
    <Card style={{ marginTop: 16, padding: '14px 16px' }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>Install from file or URL</div>
      <SettingsRow label="Source">
        <Select
          value={kind}
          onChange={e => setKind(e.target.value === 'url' ? 'url' : 'file')}
          aria-label="Install source kind"
        >
          <option value="file">Local file</option>
          <option value="url">HTTPS URL</option>
        </Select>
      </SettingsRow>
      <SettingsRow label={kind === 'url' ? 'HTTPS URL' : 'File path'}>
        <Input
          value={location}
          onChange={e => setLocation(e.target.value)}
          placeholder={kind === 'url' ? 'https://example.com/people.gatesdb' : '/path/to/people.gatesdb'}
          aria-label="Install source location"
        />
      </SettingsRow>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
        <Button
          disabled={!canInstall}
          onClick={() => { if (canInstall) onInstall?.({ kind, location: trimmed }); }}
        >
          Install
        </Button>
      </div>
      <div style={{ ...metaText, marginTop: 6 }}>
        The app verifies the bundle's integrity digest and rejects unsafe paths, executable payloads,
        and oversized archives before installing. Installed bundles start disabled and local-only.
      </div>
    </Card>
  );
}

function PluginCard({
  plugin,
  busy,
  onToggleEnabled,
  onRemove,
}: {
  plugin: DatabasePluginRow;
  busy: boolean;
  onToggleEnabled?: DatabasePluginsSectionProps['onToggleEnabled'];
  onRemove?: DatabasePluginsSectionProps['onRemove'];
}) {
  return (
    <Card style={{ padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ fontWeight: 600 }}>
          {plugin.id}{' '}
          <span style={{ color: 'var(--text-dim)', fontWeight: 400, fontSize: 12.5 }}>v{plugin.version}</span>
        </div>
        <Toggle
          on={plugin.enabled}
          disabled={busy}
          onChange={next => onToggleEnabled?.(plugin.id, next)}
        />
      </div>
      <div style={{ ...metaText, marginTop: 4 }}>{plugin.description}</div>
      <div style={{ ...metaText, marginTop: 4 }}>Publisher: {plugin.publisher}</div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
        <Pill tone={plugin.dataPolicy === 'local_only' ? 'muted' : 'warning'}>
          {plugin.dataPolicy === 'local_only' ? 'local-only' : 'cloud-allowed'}
        </Pill>
        {plugin.capabilities.map(cap => (
          <Pill key={cap} tone="muted">{cap}</Pill>
        ))}
      </div>

      {plugin.datasets.length > 0 ? (
        <div style={{ ...metaText, marginTop: 8 }}>
          Datasets: {plugin.datasets.map(d => d.title || d.id).join(', ')}
        </div>
      ) : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <Button variant="danger" disabled={busy} onClick={() => onRemove?.(plugin.id)}>
          Remove
        </Button>
      </div>
    </Card>
  );
}
