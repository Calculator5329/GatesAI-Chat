import type { CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../../core/styleTokens';
import { useImageGenStore, useProviderStore, useSearchStore } from '../../../../stores/context';
import { Button, Card, Pill, SecretKeyField } from '../../../ui';
import { ProviderCard, OPENROUTER_PROVIDER_INFO } from './ProviderCard';
import { ProviderAvatar } from './ProviderAvatar';

export const ApiSection = observer(function ApiSection() {
  const providers = useProviderStore();

  return (
    <>
      <h1 style={tokens.h1}>Models</h1>
      <div style={tokens.kicker}>Model and tool access - live catalog - keys stored locally</div>

      <Card style={{ padding: '14px 18px', marginBottom: 28, background: 'rgba(62,207,142,0.04)', borderColor: 'rgba(62,207,142,0.2)' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          Connect OpenRouter for cloud models and Brave Search for live web grounding. Keys are stored in{' '}
          <code style={tokens.mono}>localStorage</code> on this device only and used only as the
          required request header for each provider.
        </div>
      </Card>

      <ProviderCard info={OPENROUTER_PROVIDER_INFO} providers={providers} />
      <BraveSearchCard />
      <OpenRouterImageGenerationCard />
    </>
  );
});

const BraveSearchCard = observer(function BraveSearchCard() {
  const search = useSearchStore();
  const connected = search.braveReady;

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={cardHeaderStyle}>
        <ProviderAvatar name="Brave" />
        <div style={{ flex: 1 }}>
          <div style={cardTitleStyle}>Brave Search</div>
          <div style={cardDescStyle}>Live web grounding for the web_search tool.</div>
        </div>
        {connected ? <Pill>Ready</Pill> : <Pill tone="muted">Not connected</Pill>}
      </div>

      <div style={{
        paddingTop: 12,
        borderTop: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}>
        <SecretKeyField
          value={search.braveApiKey}
          onSet={key => search.setBraveKey(key)}
          onClear={() => search.clearBraveKey()}
          placeholder="Paste your Brave Search API key..."
          getKeyUrl={!connected ? 'https://api-dashboard.search.brave.com/app/keys' : undefined}
        />
        <div style={hintStyle}>
          Uses Brave LLM Context with up to 3 parallel searches per model tool call. Results are cached briefly to reduce duplicate requests.
        </div>
      </div>
    </Card>
  );
});

const OpenRouterImageGenerationCard = observer(function OpenRouterImageGenerationCard() {
  const image = useImageGenStore();
  const providers = useProviderStore();
  const connected = providers.isConnected('openrouter');
  const isActiveBackend = image.effectiveBackend === 'openrouter-image';

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={cardHeaderStyle}>
        <ProviderAvatar name="OpenRouter" />
        <div style={{ flex: 1 }}>
          <div style={cardTitleStyle}>Cloud image generation</div>
          <div style={cardDescStyle}>GPT-5.4 Image 2 through OpenRouter for image_generate.</div>
        </div>
        {connected ? <Pill>● Ready</Pill> : <Pill tone="muted">No OpenRouter key</Pill>}
      </div>

      <div style={imageBackendRowStyle}>
        <div style={imageBackendLabelStyle}>Default image backend</div>
        {isActiveBackend ? (
          <div style={imageBackendControlStyle}>
            <Pill>● Active backend</Pill>
            <span style={hintStyle}>image_generate uses OpenRouter unless ComfyUI is explicitly selected and online.</span>
          </div>
        ) : (
          <Button
            variant="accent"
            onClick={() => image.setBackend('openrouter-image')}
            disabled={!connected}
            title={!connected ? 'Add an OpenRouter API key before routing image_generate to OpenRouter.' : undefined}
          >
            Use OpenRouter for images
          </Button>
        )}
      </div>
    </Card>
  );
});

const cardHeaderStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 };
const cardTitleStyle: CSSProperties = { fontSize: 14, fontWeight: 500, color: 'var(--text)' };
const cardDescStyle: CSSProperties = { fontSize: 11.5, color: 'var(--text-faint)', marginTop: 1 };
const hintStyle: CSSProperties = { fontSize: 11.5, color: 'var(--text-faint)' };
const imageBackendRowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '180px minmax(0, 1fr)',
  gap: 24,
  alignItems: 'center',
  paddingTop: 12,
  borderTop: '1px solid var(--border)',
};
const imageBackendLabelStyle: CSSProperties = { fontSize: 12.5, color: 'var(--text-dim)' };
const imageBackendControlStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  minWidth: 0,
};
