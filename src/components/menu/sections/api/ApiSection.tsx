import type { CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../../core/styleTokens';
import { useImageGenStore, useProviderStore } from '../../../../stores/context';
import { Button, Card, Pill } from '../../../ui';
import { ProviderCard, OPENROUTER_PROVIDER_INFO } from './ProviderCard';
import { ProviderAvatar } from './ProviderAvatar';

export const ApiSection = observer(function ApiSection() {
  const providers = useProviderStore();

  return (
    <>
      <h1 style={tokens.h1}>Models</h1>
      <div style={tokens.kicker}>OpenRouter access · live catalog · keys stored locally</div>

      <Card style={{ padding: '14px 18px', marginBottom: 28, background: 'rgba(62,207,142,0.04)', borderColor: 'rgba(62,207,142,0.2)' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          Connect OpenRouter to unlock the cloud model catalog. Your key is stored in{' '}
          <code style={tokens.mono}>localStorage</code> on this device only and is used only as the
          <code style={tokens.mono}> Authorization</code> header for model requests.
        </div>
      </Card>

      <ProviderCard info={OPENROUTER_PROVIDER_INFO} providers={providers} />
      <OpenRouterImageGenerationCard />
    </>
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
