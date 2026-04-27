import { useEffect } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../../core/styleTokens';
import { useOllamaStore } from '../../../../stores/context';
import { Card, Pill, SettingsRow, Input, Button, SecretKeyField, Toggle } from '../../../ui';
import { ProviderAvatar } from './ProviderAvatar';

export const OllamaCard = observer(function OllamaCard() {
  const store = useOllamaStore();

  // Drive the status poll while this card is mounted.
  useEffect(() => {
    store.startStatusPoll();
    return () => store.stopStatusPoll();
  }, [store]);

  const status = store.state;
  const pill = status === 'online'
    ? <Pill>● Connected</Pill>
    : status === 'offline'
      ? <Pill tone="muted">○ Not running</Pill>
      : <Pill tone="muted">○ Unknown</Pill>;

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <ProviderAvatar name="Ollama" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>Ollama</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 1 }}>
            Local LLMs via the Ollama runtime.
          </div>
        </div>
        {pill}
      </div>

      <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SettingsRow label="Base URL">
          <Input
            placeholder="http://127.0.0.1:11434"
            value={store.config.baseUrl}
            onChange={e => store.setBaseUrl(e.currentTarget.value)}
            style={{ ...tokens.mono, fontSize: 12, flex: 1 }}
          />
        </SettingsRow>

        <SettingsRow label="API key (optional)">
          <SecretKeyField
            value={store.config.apiKey ?? ''}
            onSet={(k) => store.setKey(k)}
            onClear={() => store.setKey('')}
            placeholder="Only if a reverse proxy is fronting Ollama with auth"
            connectLabel="Set"
          />
        </SettingsRow>

        <SettingsRow label="Tool calls">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle
              on={store.config.toolsEnabled}
              onChange={(v) => store.setToolsEnabled(v)}
            />
            <span style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
              Off if your models behave badly with tools.
            </span>
          </div>
        </SettingsRow>

        <CatalogRow />

        {store.lastError && (
          <div style={{ fontSize: 11.5, color: '#e57373' }}>{store.lastError}</div>
        )}

        <div style={{ fontSize: 11.5, color: 'var(--text-faint)', paddingLeft: 8 }}>
          Run <code style={tokens.mono}>ollama pull llama3.1</code> to add a model. Status refreshes every 30s while this panel is open.
        </div>
      </div>
    </Card>
  );
});

const CatalogRow = observer(function CatalogRow() {
  const store = useOllamaStore();
  const { count, lastRefreshAt, fetching } = store;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ flex: 1, fontSize: 11.5, color: 'var(--text-faint)' }}>
        {count > 0
          ? <>{count} model{count === 1 ? '' : 's'} · last refreshed {formatTs(lastRefreshAt)}</>
          : <>No models pulled yet</>
        }
      </div>
      <Button onClick={() => { void store.refresh(); }} disabled={fetching}>
        {fetching ? 'Refreshing…' : (count > 0 ? 'Refresh' : 'Load models')}
      </Button>
      {count > 0 && !fetching && (
        <Button variant="danger" onClick={() => store.clearCatalog()}>Clear</Button>
      )}
    </div>
  );
});

function formatTs(ts: number | null): string {
  if (!ts) return 'never';
  const d = new Date(ts);
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
