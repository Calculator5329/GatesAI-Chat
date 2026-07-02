import { useState, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { useMcpStore } from '../../../stores/context';
import type { McpConnectionStatus, McpServerConfig } from '../../../stores/McpStore';
import { Button, Input, Pill, Toggle } from '../../ui';

interface HeaderDraft {
  name: string;
  value: string;
}

export const McpSettingsBlock = observer(function McpSettingsBlock() {
  const mcp = useMcpStore();
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [headers, setHeaders] = useState<HeaderDraft[]>([{ name: 'Authorization', value: '' }]);

  const addHeader = () => setHeaders(rows => [...rows, { name: '', value: '' }]);
  const updateHeader = (index: number, patch: Partial<HeaderDraft>) => {
    setHeaders(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  };
  const removeHeader = (index: number) => {
    setHeaders(rows => rows.filter((_, i) => i !== index));
  };
  const addServer = () => {
    if (!url.trim()) return;
    const id = mcp.addServer({
      label,
      url,
      headers: headersToRecord(headers),
      enabled: true,
    });
    setLabel('');
    setUrl('');
    setHeaders([{ name: 'Authorization', value: '' }]);
    void mcp.testConnection(id);
  };

  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>MCP</div>
      <div style={S.help}>
        Streamable HTTP MCP servers can expose external tools to the model. Browser CSP allows https and localhost http endpoints; plain-http remote servers will not work.
      </div>

      <div style={S.addBox}>
        <div style={S.grid2}>
          <Input value={label} onChange={event => setLabel(event.target.value)} placeholder="Label" />
          <Input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/mcp" />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {headers.map((header, index) => (
            <div key={index} style={S.headerRow}>
              <Input
                value={header.name}
                onChange={event => updateHeader(index, { name: event.target.value })}
                placeholder="Header"
                style={{ minWidth: 130 }}
              />
              <Input
                type="password"
                value={header.value}
                onChange={event => updateHeader(index, { value: event.target.value })}
                placeholder="Value"
                style={{ flex: 1 }}
              />
              <Button onClick={() => removeHeader(index)} style={S.smallButton}>Remove</Button>
            </div>
          ))}
        </div>
        <div style={S.addActions}>
          <Button onClick={addHeader}>Add header</Button>
          <Button onClick={addServer} disabled={!url.trim()} variant="accent">Add server</Button>
        </div>
      </div>

      {mcp.servers.length === 0 ? (
        <div style={S.empty}>No MCP servers configured.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {mcp.servers.map(server => (
            <McpServerRow key={server.id} server={server} />
          ))}
        </div>
      )}
    </div>
  );
});

const McpServerRow = observer(function McpServerRow({ server }: { server: McpServerConfig }) {
  const mcp = useMcpStore();
  const status = mcp.statusFor(server.id);
  const tools = mcp.toolsForServer(server.id);
  const connecting = status.state === 'connecting';

  const setHeader = (oldName: string, nextName: string, nextValue: string) => {
    const next = { ...server.headers };
    delete next[oldName];
    if (nextName.trim()) next[nextName] = nextValue;
    mcp.updateServer(server.id, { headers: next });
  };
  const addHeader = () => {
    const next = { ...server.headers };
    let name = 'Authorization';
    let suffix = 2;
    while (name in next) {
      name = `X-MCP-Header-${suffix}`;
      suffix += 1;
    }
    next[name] = '';
    mcp.updateServer(server.id, { headers: next });
  };

  return (
    <div style={S.serverBox}>
      <div style={S.serverTop}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <Input
            value={server.label}
            onChange={event => mcp.updateServer(server.id, { label: event.target.value })}
            style={{ fontWeight: 500 }}
          />
        </div>
        <StatusPill status={status} />
        <Toggle on={server.enabled} onChange={next => mcp.setServerEnabled(server.id, next)} />
      </div>

      <Input
        value={server.url}
        onChange={event => mcp.updateServer(server.id, { url: event.target.value })}
        placeholder="MCP endpoint"
        style={{ marginTop: 8 }}
      />

      <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Object.entries(server.headers).map(([name, value]) => (
          <div key={name} style={S.headerRow}>
            <Input
              value={name}
              onChange={event => setHeader(name, event.target.value, value)}
              placeholder="Header"
              style={{ minWidth: 130 }}
            />
            <Input
              type="password"
              value={value}
              onChange={event => setHeader(name, name, event.target.value)}
              placeholder="Value"
              style={{ flex: 1 }}
            />
            <Button onClick={() => setHeader(name, '', '')} style={S.smallButton}>Remove</Button>
          </div>
        ))}
      </div>

      <div style={S.serverActions}>
        <Button onClick={addHeader}>Add header</Button>
        <Button
          onClick={() => { void mcp.testConnection(server.id); }}
          disabled={!server.enabled || connecting}
        >
          {connecting ? 'Checking...' : 'Test connection'}
        </Button>
        <Button
          variant="danger"
          onClick={() => {
            if (window.confirm(`Remove MCP server "${server.label}"?`)) mcp.removeServer(server.id);
          }}
        >
          Remove
        </Button>
      </div>

      {status.message && <div style={status.state === 'error' ? S.error : S.note}>{status.message}</div>}

      {status.state === 'connected' && (
        <div style={S.toolList}>
          {tools.length === 0 ? (
            <div style={S.empty}>Connected, but this server did not return tools.</div>
          ) : (
            tools.map(tool => (
              <div key={tool.name} style={S.toolRow}>
                <div style={S.toolName}>{tool.name}</div>
                <div style={S.toolDesc}>{tool.description || 'No description.'}</div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
});

function StatusPill({ status }: { status: McpConnectionStatus }) {
  if (status.state === 'connected') return <Pill tone="accent">connected</Pill>;
  if (status.state === 'connecting') return <Pill tone="warning">checking</Pill>;
  if (status.state === 'error') return <Pill tone="danger">{status.errorKind ?? 'error'}</Pill>;
  if (status.state === 'disabled') return <Pill tone="muted">disabled</Pill>;
  return <Pill tone="muted">offline</Pill>;
}

function headersToRecord(headers: HeaderDraft[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const header of headers) {
    const name = header.name.trim();
    const value = header.value.trim();
    if (!name || !value) continue;
    out[name] = value;
  }
  return out;
}

const S = {
  help: {
    fontSize: 12.5,
    color: 'var(--text-dim)',
    marginBottom: 14,
    lineHeight: 1.55,
  } as CSSProperties,
  addBox: {
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: 12,
    marginBottom: 14,
  } as CSSProperties,
  grid2: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
    gap: 8,
  } as CSSProperties,
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  } as CSSProperties,
  addActions: {
    display: 'flex',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 10,
  } as CSSProperties,
  serverBox: {
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: 12,
  } as CSSProperties,
  serverTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  } as CSSProperties,
  serverActions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  } as CSSProperties,
  smallButton: {
    flex: 'none',
  } as CSSProperties,
  note: {
    marginTop: 10,
    color: 'var(--text-faint)',
    fontSize: 12,
  } as CSSProperties,
  error: {
    marginTop: 10,
    color: '#e57373',
    fontSize: 12,
  } as CSSProperties,
  empty: {
    fontSize: 12,
    color: 'var(--text-faint)',
    fontStyle: 'italic',
  } as CSSProperties,
  toolList: {
    marginTop: 12,
    borderTop: '1px solid var(--border)',
  } as CSSProperties,
  toolRow: {
    display: 'grid',
    gridTemplateColumns: 'minmax(130px, 0.35fr) minmax(180px, 1fr)',
    gap: 12,
    padding: '10px 0',
    borderBottom: '1px solid var(--border)',
  } as CSSProperties,
  toolName: {
    ...tokens.mono,
    color: 'var(--text)',
    overflowWrap: 'anywhere',
  } as CSSProperties,
  toolDesc: {
    fontSize: 12.5,
    color: 'var(--text-dim)',
    lineHeight: 1.45,
  } as CSSProperties,
};
