// Renders API-provider controls for Api Section.
// Called by ApiSection or GatesMenu; depends on provider/local-runtime stores and shared form controls.
// Invariant: provider secrets and catalog state are changed only through store actions.
import { useEffect, useState, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../../core/styleTokens';
import {
  useLocalRuntimeStore,
  useOllamaStore,
  useProviderStore,
  useSearchStore,
} from '../../../../stores/context';
import { Button, Card, Input, Pill, SecretKeyField } from '../../../ui';
import { ProviderCard, OPENROUTER_PROVIDER_INFO } from './ProviderCard';
import { ProviderAvatar } from './ProviderAvatar';

export const ApiSection = observer(function ApiSection() {
  const providers = useProviderStore();

  return (
    <>
      <h1 style={tokens.h1}>Models</h1>
      <div style={tokens.kicker}>OpenRouter · Ollama · Brave search</div>

      <Card style={{ padding: '14px 18px', marginBottom: 28, background: 'var(--success-card-bg)', borderColor: 'var(--success-card-border)' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          Cloud chat uses your own OpenRouter key; local chat uses Ollama on this
          computer; web answers and research use Brave Search. Keys are stored in the OS credential store on desktop and{' '}
          <code style={tokens.mono}>localStorage</code> in the browser, and used
          only as the required request header for each provider.
        </div>
      </Card>

      <ProviderCard info={OPENROUTER_PROVIDER_INFO} providers={providers} />
      <LocalModelsCard />
      <SearchCard />
    </>
  );
});

const SearchCard = observer(function SearchCard() {
  const search = useSearchStore();
  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={cardHeaderStyle}>
        <ProviderAvatar name="Brave" />
        <div style={{ flex: 1 }}>
          <div style={cardTitleStyle}>Web search</div>
          <div style={cardDescStyle}>Brave grounding for quick answers and background deep research</div>
        </div>
        {search.braveReady ? <Pill>● Connected</Pill> : <Pill tone="muted">Not connected</Pill>}
      </div>
      <div style={localPanelStyle}>
        <SecretKeyField
          value={search.braveApiKey}
          onSet={key => search.setBraveKey(key)}
          onClear={() => search.clearBraveKey()}
          placeholder="Paste your Brave Search API key…"
          getKeyUrl={search.braveReady ? undefined : 'https://api.search.brave.com/app/keys'}
        />
        <div style={hintStyle}>
          Quick answers use a compact search budget. Research runs broader multi-pass searches in a visible background task.
        </div>
      </div>
    </Card>
  );
});

const LocalModelsCard = observer(function LocalModelsCard() {
  const local = useLocalRuntimeStore();
  const ollama = useOllamaStore();
  const online = local.runtimes.ollama.status === 'online';
  const [draft, setDraft] = useState(local.ollamaBaseUrl);
  useEffect(() => {
    setDraft(local.ollamaBaseUrl);
  }, [local.ollamaBaseUrl]);

  const commit = (): void => {
    local.setBaseUrl('ollama', draft);
    void ollama.refresh();
  };

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={cardHeaderStyle}>
        <ProviderAvatar name="Ollama" />
        <div style={{ flex: 1 }}>
          <div style={cardTitleStyle}>Local models</div>
          <div style={cardDescStyle}>
            {online
              ? `Ollama online · ${ollama.count} model${ollama.count === 1 ? '' : 's'}`
              : 'Ollama not running — start it and refresh.'}
          </div>
        </div>
        {online ? <Pill>● Online</Pill> : <Pill tone="muted">Offline</Pill>}
      </div>

      <div style={localPanelStyle}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <Input
            value={draft}
            onChange={e => setDraft(e.currentTarget.value)}
            onKeyDown={e => { if (e.key === 'Enter') commit(); }}
            placeholder="http://127.0.0.1:11434"
            style={{ flex: 1, minWidth: 220 }}
          />
          <Button onClick={commit} disabled={ollama.fetching}>
            {ollama.fetching ? 'Refreshing…' : 'Refresh models'}
          </Button>
        </div>
        {ollama.lastError && (
          <div style={{ fontSize: 11.5, color: 'var(--danger)' }}>
            Catalog refresh failed: {ollama.lastError}
          </div>
        )}
        <div style={hintStyle}>
          Models installed with <code style={tokens.mono}>ollama pull</code> appear in the model picker automatically.
        </div>
      </div>
    </Card>
  );
});

const cardHeaderStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 };
const cardTitleStyle: CSSProperties = { fontSize: 14, fontWeight: 500, color: 'var(--text)' };
const cardDescStyle: CSSProperties = { fontSize: 11.5, color: 'var(--text-faint)', marginTop: 1 };
const hintStyle: CSSProperties = { fontSize: 11.5, color: 'var(--text-faint)' };
const localPanelStyle: CSSProperties = {
  paddingTop: 12,
  borderTop: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};
