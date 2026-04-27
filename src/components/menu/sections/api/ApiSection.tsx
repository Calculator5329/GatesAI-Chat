import { observer } from 'mobx-react-lite';
import { tokens } from '../../../../core/styleTokens';
import { PROVIDERS } from '../../../../core/providers';
import { useProviderStore } from '../../../../stores/context';
import { Card } from '../../../ui';
import { ProviderCard } from './ProviderCard';
import { RoutingCard } from './RoutingCard';

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

      {PROVIDERS.filter(p => p.id !== 'local').map(p => (
        <ProviderCard key={p.id} info={p} providers={providers} />
      ))}

      <RoutingCard />
    </>
  );
});
