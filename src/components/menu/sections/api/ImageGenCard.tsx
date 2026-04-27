import { observer } from 'mobx-react-lite';
import { useImageGenStore } from '../../../../stores/context';
import { Card, Pill, SettingsRow, Select, SecretKeyField } from '../../../ui';
import { ProviderAvatar } from './ProviderAvatar';

export const ImageGenCard = observer(function ImageGenCard() {
  const store = useImageGenStore();
  const backend = store.backend === 'bfl' ? 'bfl' : 'fal';
  const connected = Boolean(store.getCredential(backend));

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <ProviderAvatar name="image" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
            {backend === 'fal' && 'fal.ai (FLUX 2)'}
            {backend === 'bfl' && 'Black Forest Labs'}
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginTop: 1 }}>
            Text-to-image. Artifacts land in /workspace/artifacts/.
          </div>
        </div>
        {connected
          ? <Pill>● Connected</Pill>
          : <Pill tone="muted">Not connected</Pill>
        }
      </div>

      <div style={{ paddingTop: 12, borderTop: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SettingsRow label="Backend">
          <Select
            value={backend}
            onChange={e => store.setBackend(e.currentTarget.value as 'fal' | 'bfl')}
          >
            <option value="fal">fal.ai (cloud, FLUX 2)</option>
            <option value="bfl" disabled>Black Forest Labs (soon)</option>
          </Select>
        </SettingsRow>

        {backend === 'fal' && <FalBackendFields />}

        <PromptEnhancementFields />
      </div>
    </Card>
  );
});

const PromptEnhancementFields = observer(function PromptEnhancementFields() {
  const store = useImageGenStore();
  const enabled = store.config.promptEnhancement ?? 'off';

  return (
    <>
      <SettingsRow label="Prompt enhancement">
        <Select
          value={enabled}
          onChange={e => store.setPromptEnhancement(e.currentTarget.value as 'off' | 'llm')}
        >
          <option value="llm">On — rewrite prompts for image models</option>
          <option value="off">Off — use prompt exactly as written</option>
        </Select>
      </SettingsRow>
      {enabled === 'llm' && (
        <SettingsRow label="Style preset">
          <Select
            value={store.config.promptStylePreset ?? 'auto'}
            onChange={e => store.setPromptStylePreset(e.currentTarget.value as 'auto' | 'photorealistic' | 'concept-art' | 'abstract' | 'illustration')}
          >
            <option value="auto">Auto</option>
            <option value="photorealistic">Photorealistic</option>
            <option value="concept-art">Concept art</option>
            <option value="abstract">Abstract</option>
            <option value="illustration">Illustration</option>
          </Select>
        </SettingsRow>
      )}
    </>
  );
});

const FalBackendFields = observer(function FalBackendFields() {
  const store = useImageGenStore();
  const existingKey = store.config.falApiKey ?? '';

  return (
    <>
      <SettingsRow label="API key">
        <SecretKeyField
          value={existingKey}
          onSet={(k) => store.setFalKey(k)}
          onClear={() => store.setFalKey('')}
          placeholder="Paste your fal.ai API key…"
          getKeyUrl="https://fal.ai/dashboard/keys"
        />
      </SettingsRow>
      {existingKey && (
        <SettingsRow label="Default variant">
          <Select
            value={store.config.defaultVariant ?? 'flux-2-pro'}
            onChange={e => store.setDefaultVariant(e.currentTarget.value as 'flux-2-pro' | 'flux-2-flex' | 'flux-2-dev')}
          >
            <option value="flux-2-pro">flux-2-pro (quality)</option>
            <option value="flux-2-flex">flux-2-flex (balanced)</option>
            <option value="flux-2-dev">flux-2-dev (fast)</option>
          </Select>
        </SettingsRow>
      )}
    </>
  );
});

