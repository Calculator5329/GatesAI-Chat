import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../../core/styleTokens';
import type { PROVIDERS } from '../../../../core/providers';
import { useProviderStore } from '../../../../stores/context';
import { Card, Pill, Input, Button, SecretKeyField } from '../../../ui';
import { ProviderAvatar } from './ProviderAvatar';
import { OpenRouterCatalogRow } from './OpenRouterCatalogRow';

interface ProviderCardProps {
  info: typeof PROVIDERS[number];
  providers: ReturnType<typeof useProviderStore>;
}

export const ProviderCard = observer(function ProviderCard({ info, providers }: ProviderCardProps) {
  const config = providers.getConfig(info.id);
  const connected = providers.isConnected(info.id);
  const [draftBaseUrl, setDraftBaseUrl] = useState(config.baseUrl ?? info.defaultBaseUrl ?? '');

  const onSetKey = (key: string): void => {
    providers.setKey(info.id, key);
    if (info.needsBaseUrl && draftBaseUrl.trim()) providers.setBaseUrl(info.id, draftBaseUrl);
  };

  const onConnectBaseUrlOnly = (): void => {
    if (info.needsBaseUrl) providers.setBaseUrl(info.id, draftBaseUrl);
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

      <div style={{
        paddingTop: 12, borderTop: '1px solid var(--border)',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {info.needsBaseUrl && (
          <Input
            placeholder="Base URL (OpenAI-compatible)"
            value={connected ? (config.baseUrl ?? '') : draftBaseUrl}
            readOnly={connected}
            onChange={e => setDraftBaseUrl(e.currentTarget.value)}
            style={{ ...tokens.mono, fontSize: 12, flex: 1 }}
          />
        )}
        {info.needsKey ? (
          <SecretKeyField
            value={config.apiKey ?? ''}
            onSet={onSetKey}
            onClear={() => providers.remove(info.id)}
            placeholder={`Paste your ${info.name} API key…`}
            getKeyUrl={!connected ? info.keyUrl : undefined}
          />
        ) : info.needsBaseUrl && !connected ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="accent" disabled={!draftBaseUrl.trim()} onClick={onConnectBaseUrlOnly}>Connect</Button>
          </div>
        ) : info.needsBaseUrl && connected ? (
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button variant="danger" onClick={() => providers.remove(info.id)}>Remove</Button>
          </div>
        ) : null}
      </div>

      {info.id === 'openrouter' && <OpenRouterCatalogRow />}
    </Card>
  );
});
