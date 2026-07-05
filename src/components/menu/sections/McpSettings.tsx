import { useState, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { useMcpStore } from '../../../stores/context';
import type { McpConnectionStatus, McpServerConfig } from '../../../stores/McpStore';
import { Button, Input, Pill, SegmentedControl, Textarea, Toggle } from '../../ui';

interface HeaderDraft {
  name: string;
  value: string;
}

export const McpSettingsBlock = observer(function McpSettingsBlock() {
  const mcp = useMcpStore();
  const [transport, setTransport] = useState<'HTTP URL' | 'Local command'>('HTTP URL');
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [command, setCommand] = useState('');
  const [argsText, setArgsText] = useState('');
  const [headers, setHeaders] = useState<HeaderDraft[]>([{ name: 'Authorization', value: '' }]);
  const [env, setEnv] = useState<HeaderDraft[]>([{ name: '', value: '' }]);
  const [stdioWarningShown, setStdioWarningShown] = useState(false);

  const addHeader = () => setHeaders(rows => [...rows, { name: '', value: '' }]);
  const addEnv = () => setEnv(rows => [...rows, { name: '', value: '' }]);
  const updateHeader = (index: number, patch: Partial<HeaderDraft>) => {
    setHeaders(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  };
  const updateEnv = (index: number, patch: Partial<HeaderDraft>) => {
    setEnv(rows => rows.map((row, i) => i === index ? { ...row, ...patch } : row));
  };
  const removeHeader = (index: number) => {
    setHeaders(rows => rows.filter((_, i) => i !== index));
  };
  const removeEnv = (index: number) => {
    setEnv(rows => rows.filter((_, i) => i !== index));
  };
  const addServer = () => {
    let id = '';
    if (transport === 'HTTP URL') {
      if (!url.trim()) return;
      id = mcp.addServer({
        label,
        url,
        headers: headersToRecord(headers),
        enabled: true,
      });
    } else {
      if (!command.trim()) return;
      if (!stdioWarningShown) {
        window.alert('This runs a program on your computer with your permissions. Only add servers you trust.');
        setStdioWarningShown(true);
      }
      id = mcp.addStdioServer({
        label,
        command,
        args: splitArgs(argsText),
        env: headersToRecord(env),
        enabled: true,
      });
    }
    setLabel('');
    setUrl('');
    setCommand('');
    setArgsText('');
    setHeaders([{ name: 'Authorization', value: '' }]);
    setEnv([{ name: '', value: '' }]);
    void mcp.testConnection(id);
  };
  const addDisabled = transport === 'HTTP URL' ? !url.trim() : !command.trim();

  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>MCP</div>
      <div style={S.help}>
        Streamable HTTP and local command MCP servers can expose external tools to the model. Browser CSP allows https and localhost http endpoints; plain-http remote servers will not work.
      </div>

      <div style={S.addBox}>
        <SegmentedControl options={['HTTP URL', 'Local command'] as const} value={transport} onChange={setTransport} />
        <div style={S.grid2}>
          <Input value={label} onChange={event => setLabel(event.target.value)} placeholder="Label" />
          {transport === 'HTTP URL' ? (
            <Input value={url} onChange={event => setUrl(event.target.value)} placeholder="https://example.com/mcp" />
          ) : (
            <Input value={command} onChange={event => setCommand(event.target.value)} placeholder="npx" />
          )}
        </div>
        {transport === 'HTTP URL' ? (
          <>
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
              <Button onClick={addServer} disabled={addDisabled} variant="accent">Add server</Button>
            </div>
          </>
        ) : (
          <>
            <Textarea
              value={argsText}
              onChange={event => setArgsText(event.target.value)}
              placeholder="Arguments, e.g. @modelcontextprotocol/server-filesystem C:\path"
              rows={2}
              style={{ marginTop: 10, resize: 'vertical' }}
            />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
              {env.map((item, index) => (
                <div key={index} style={S.headerRow}>
                  <Input
                    value={item.name}
                    onChange={event => updateEnv(index, { name: event.target.value })}
                    placeholder="Env name"
                    style={{ minWidth: 130 }}
                  />
                  <Input
                    type="password"
                    value={item.value}
                    onChange={event => updateEnv(index, { value: event.target.value })}
                    placeholder="Value"
                    style={{ flex: 1 }}
                  />
                  <Button onClick={() => removeEnv(index)} style={S.smallButton}>Remove</Button>
                </div>
              ))}
            </div>
            <div style={S.addActions}>
              <Button onClick={addEnv}>Add env</Button>
              <Button onClick={addServer} disabled={addDisabled} variant="accent">Add server</Button>
            </div>
          </>
        )}
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
  const connecting = status.state === 'starting';

  const setHeader = (oldName: string, nextName: string, nextValue: string) => {
    if (server.transport !== 'http') return;
    const next = { ...server.headers };
    delete next[oldName];
    if (nextName.trim()) next[nextName] = nextValue;
    mcp.updateServer(server.id, { headers: next });
  };
  const addHeader = () => {
    if (server.transport !== 'http') return;
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
  const setEnv = (oldName: string, nextName: string, nextValue: string) => {
    if (server.transport !== 'stdio') return;
    const next = { ...server.env };
    delete next[oldName];
    if (nextName.trim()) next[nextName] = nextValue;
    mcp.updateServer(server.id, { env: next });
  };
  const addEnv = () => {
    if (server.transport !== 'stdio') return;
    const next = { ...server.env };
    let name = 'MCP_ENV';
    let suffix = 2;
    while (name in next) {
      name = `MCP_ENV_${suffix}`;
      suffix += 1;
    }
    next[name] = '';
    mcp.updateServer(server.id, { env: next });
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

      {server.transport === 'http' ? (
        <>
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
        </>
      ) : (
        <>
          <Input
            value={server.command}
            onChange={event => mcp.updateServer(server.id, { command: event.target.value })}
            placeholder="Command"
            style={{ marginTop: 8 }}
          />
          <Textarea
            value={server.args.join(' ')}
            onChange={event => mcp.updateServer(server.id, { args: splitArgs(event.target.value) })}
            placeholder="Arguments"
            rows={2}
            style={{ marginTop: 8, resize: 'vertical' }}
          />
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {Object.entries(server.env).map(([name, value]) => (
              <div key={name} style={S.headerRow}>
                <Input
                  value={name}
                  onChange={event => setEnv(name, event.target.value, value)}
                  placeholder="Env name"
                  style={{ minWidth: 130 }}
                />
                <Input
                  type="password"
                  value={value}
                  onChange={event => setEnv(name, name, event.target.value)}
                  placeholder="Value"
                  style={{ flex: 1 }}
                />
                <Button onClick={() => setEnv(name, '', '')} style={S.smallButton}>Remove</Button>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={S.serverActions}>
        {server.transport === 'http' ? <Button onClick={addHeader}>Add header</Button> : <Button onClick={addEnv}>Add env</Button>}
        <Button
          onClick={() => { void mcp.testConnection(server.id); }}
          disabled={!server.enabled || connecting}
        >
          {connecting ? 'Starting...' : 'Test connection'}
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

      {status.state === 'running' && (
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
  if (status.state === 'running') return <Pill tone="accent">running</Pill>;
  if (status.state === 'starting') return <Pill tone="warning">starting</Pill>;
  if (status.state === 'exited') return <Pill tone="warning">{status.exitCode === null || status.exitCode === undefined ? 'exited' : `exited(${status.exitCode})`}</Pill>;
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

function splitArgs(value: string): string[] {
  const args: string[] = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^']*)'|[^\s]+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    args.push((match[1] ?? match[2] ?? match[0]).replace(/\\"/g, '"'));
  }
  return args;
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
