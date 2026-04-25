import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { PROVIDERS } from '../../../core/providers';
import { useOpenRouterStore, useProviderStore } from '../../../stores/context';
import { Card, Pill, SettingsRow, Input, Select, Button } from '../../ui';

function maskKey(key: string): string {
  if (!key) return '';
  if (key.length <= 8) return '*'.repeat(key.length);
  return `${key.slice(0, 7)}${'*'.repeat(Math.max(0, key.length - 11))}${key.slice(-4)}`;
}

export const ApiSection = observer(function ApiSection() {
  const providers = useProviderStore();

  return (
    <>
      <h1 style={tokens.h1}>API</h1>
      <div style={tokens.kicker}>bring your own keys · byok · stored locally in your browser</div>

      <Card style={{ padding: '14px 18px', marginBottom: 28, background: 'rgba(62,207,142,0.04)', borderColor: 'rgba(62,207,142,0.2)' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          Keys are stored in <code style={tokens.mono}>localStorage</code> on this device only. They never leave your browser
          except as the <code style={tokens.mono}>Authorization</code> header on requests to the chosen provider.
        </div>
      </Card>

      {PROVIDERS.map(p => (
        <ProviderCard key={p.id} info={p} providers={providers} />
      ))}

      <div style={{ ...tokens.section, marginTop: 32 }}>
        <div style={tokens.sectionTitle}>Routing</div>
        <SettingsRow label="Default provider">
          <Select defaultValue="openrouter">
            <option value="openrouter">OpenRouter (auto-route)</option>
            <option value="anthropic">Anthropic direct</option>
            <option value="openai">OpenAI direct</option>
            <option value="gemini">Google direct</option>
            <option value="groq">Groq direct</option>
            <option value="local">Local endpoint</option>
          </Select>
        </SettingsRow>
        <SettingsRow label="Fallback when no key">
          <span style={{ color: 'var(--text-dim)' }}>Use the built-in mock responder</span>
        </SettingsRow>
        <SettingsRow label="Monthly spend cap" last>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={tokens.mono}>$</span>
            <Input defaultValue="100.00" style={{ ...tokens.mono, width: 120 }} />
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>hard stop at limit</span>
          </div>
        </SettingsRow>
      </div>
    </>
  );
});

interface ProviderCardProps {
  info: typeof PROVIDERS[number];
  providers: ReturnType<typeof useProviderStore>;
}

const ProviderCard = observer(function ProviderCard({ info, providers }: ProviderCardProps) {
  const config = providers.getConfig(info.id);
  const connected = providers.isConnected(info.id);
  const [draftKey, setDraftKey] = useState('');
  const [draftBaseUrl, setDraftBaseUrl] = useState(config.baseUrl ?? info.defaultBaseUrl ?? '');
  const [revealed, setRevealed] = useState(false);

  const onConnect = (): void => {
    if (info.needsKey && draftKey.trim()) providers.setKey(info.id, draftKey);
    if (info.needsBaseUrl) providers.setBaseUrl(info.id, draftBaseUrl);
    setDraftKey('');
    setRevealed(false);
  };

  const onRemove = (): void => {
    providers.remove(info.id);
    setDraftKey('');
    setRevealed(false);
  };

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <ProviderAvatar name={info.name} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>{info.name}</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 1 }}>{info.desc}</div>
        </div>
        {connected
          ? <Pill>● Connected</Pill>
          : <Pill tone="muted">Not connected</Pill>
        }
      </div>

      {connected ? (
        <ConnectedRow
          info={info}
          config={config}
          revealed={revealed}
          onToggleReveal={() => setRevealed(v => !v)}
          onRemove={onRemove}
        />
      ) : (
        <ConnectRow
          info={info}
          draftKey={draftKey}
          draftBaseUrl={draftBaseUrl}
          onChangeKey={setDraftKey}
          onChangeBaseUrl={setDraftBaseUrl}
          onConnect={onConnect}
        />
      )}

      {info.keyUrl && !connected && (
        <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text-faint)' }}>
          Get a key →{' '}
          <a href={info.keyUrl} target="_blank" rel="noreferrer"
             style={{ color: 'var(--accent)', textDecoration: 'none' }}>
            {info.keyUrl.replace(/^https?:\/\//, '')}
          </a>
        </div>
      )}

      {info.id === 'openrouter' && <OpenRouterCatalogRow />}
    </Card>
  );
});

const OpenRouterCatalogRow = observer(function OpenRouterCatalogRow() {
  const store = useOpenRouterStore();
  const { count, fetchedAt, fetching, fetchError } = store;

  return (
    <div style={{
      marginTop: 12, paddingTop: 12,
      borderTop: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
            Model catalog
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
            {count > 0
              ? <>{count.toLocaleString()} models · last refreshed {formatTimestamp(fetchedAt)}</>
              : <>Not loaded yet — pull the live list from OpenRouter</>}
          </div>
        </div>
        <Button onClick={() => { void store.refresh(); }} disabled={fetching}>
          {fetching ? 'Refreshing…' : (count > 0 ? 'Refresh' : 'Load models')}
        </Button>
        {count > 0 && !fetching && (
          <Button variant="danger" onClick={() => store.clearCache()}>Clear</Button>
        )}
      </div>
      {fetchError && (
        <div style={{ fontSize: 11.5, color: '#e57373' }}>{fetchError}</div>
      )}
    </div>
  );
});

function formatTimestamp(ts: number | null): string {
  if (!ts) return 'never';
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

function ProviderAvatar({ name }: { name: string }) {
  return (
    <div style={{
      width: 38, height: 38, borderRadius: 8,
      background: 'var(--panel)',
      border: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: '"Source Serif 4", Georgia, serif',
      fontStyle: 'italic', fontSize: 18,
      color: 'var(--text-dim)',
    }}>{name[0]}</div>
  );
}

interface ConnectedRowProps {
  info: typeof PROVIDERS[number];
  config: { apiKey?: string; baseUrl?: string };
  revealed: boolean;
  onToggleReveal: () => void;
  onRemove: () => void;
}

function ConnectedRow({ info, config, revealed, onToggleReveal, onRemove }: ConnectedRowProps) {
  return (
    <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {info.needsKey && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Input
            readOnly
            value={revealed ? (config.apiKey ?? '') : maskKey(config.apiKey ?? '')}
            style={{ ...tokens.mono, fontSize: 12, flex: 1 }}
          />
          <Button onClick={onToggleReveal}>{revealed ? 'Hide' : 'Reveal'}</Button>
          <Button variant="danger" onClick={onRemove}>Remove</Button>
        </div>
      )}
      {info.needsBaseUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Input readOnly value={config.baseUrl ?? ''} style={{ ...tokens.mono, fontSize: 12, flex: 1 }} />
          {!info.needsKey && <Button variant="danger" onClick={onRemove}>Remove</Button>}
        </div>
      )}
    </div>
  );
}

interface ConnectRowProps {
  info: typeof PROVIDERS[number];
  draftKey: string;
  draftBaseUrl: string;
  onChangeKey: (v: string) => void;
  onChangeBaseUrl: (v: string) => void;
  onConnect: () => void;
}

function ConnectRow({ info, draftKey, draftBaseUrl, onChangeKey, onChangeBaseUrl, onConnect }: ConnectRowProps) {
  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      {info.needsBaseUrl && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Input
            placeholder="Base URL (OpenAI-compatible)"
            value={draftBaseUrl}
            onChange={e => onChangeBaseUrl(e.currentTarget.value)}
            style={{ ...tokens.mono, fontSize: 12, flex: 1 }}
          />
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {info.needsKey && (
          <Input
            type="password"
            placeholder={`Paste your ${info.name} API key…`}
            value={draftKey}
            onChange={e => onChangeKey(e.currentTarget.value)}
            style={{ flex: 1 }}
            onKeyDown={e => { if (e.key === 'Enter') onConnect(); }}
          />
        )}
        <Button variant="accent" onClick={onConnect}
          disabled={(info.needsKey && !draftKey.trim()) && (!info.needsBaseUrl || !draftBaseUrl.trim())}>
          Connect
        </Button>
      </div>
    </div>
  );
}
