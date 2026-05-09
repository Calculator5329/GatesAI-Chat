import { observer } from 'mobx-react-lite';
import { tokens } from '../../../../core/styleTokens';
import { useProviderStore } from '../../../../stores/context';
import { Card } from '../../../ui';
import { ProviderCard, OPENROUTER_PROVIDER_INFO } from './ProviderCard';

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
    </>
  );
});
