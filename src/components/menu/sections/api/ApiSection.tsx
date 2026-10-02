// Renders API-provider controls for Api Section.
// Called by GatesMenu (desktop only; Web Lite folds keys into Settings); depends on provider stores and shared form controls.
// Invariant: provider secrets and catalog state are changed only through store actions.
import type { CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../../core/styleTokens';
import { useProviderStore, useSearchStore } from '../../../../stores/context';
import { Card, Pill, SecretKeyField } from '../../../ui';
import { LocalCard } from './LocalCard';
import { ProviderCard, OPENROUTER_PROVIDER_INFO } from './ProviderCard';
import { ProviderAvatar } from './ProviderAvatar';

export const ApiSection = observer(function ApiSection() {
  const providers = useProviderStore();

  return (
    <>
      <h1 style={tokens.h1}>Models</h1>
      <div style={tokens.kicker}>Local · OpenRouter · Brave search</div>

      <Card style={{ padding: '14px 18px', marginBottom: 28, background: 'var(--success-card-bg)', borderColor: 'var(--success-card-border)' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          Local chat runs on Ollama, on this computer or a server you name, and
          local images on ComfyUI. Both are found on their own. Cloud chat uses
          your own OpenRouter key; web answers and research use Brave Search.
          Keys are stored in the OS credential store and used only as the
          required request header for each provider.
        </div>
      </Card>

      <LocalCard />
      <ProviderCard info={OPENROUTER_PROVIDER_INFO} providers={providers} />
      <SearchCard />
    </>
  );
});

export const SearchCard = observer(function SearchCard() {
  const search = useSearchStore();
  return (
    <Card style={{ marginBottom: 12 }} data-testid="settings.models.search-card">
      <div style={cardHeaderStyle}>
        <ProviderAvatar name="Brave" />
        <div style={{ flex: 1 }}>
          <div style={cardTitleStyle}>Web search</div>
          <div style={cardDescStyle}>Brave grounding for web answers</div>
        </div>
        {search.braveReady ? <Pill>● Connected</Pill> : <Pill tone="muted">Not connected</Pill>}
      </div>
      <div style={localPanelStyle}>
        <SecretKeyField
          identityKey="brave"
          value={search.braveApiKey}
          onSet={key => search.setBraveKey(key)}
          onClear={() => search.clearBraveKey()}
          placeholder="Paste your Brave Search API key…"
          getKeyUrl={search.braveReady ? undefined : 'https://api.search.brave.com/app/keys'}
        />
        <div style={hintStyle}>
          Web answers use a compact search budget per turn.
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
