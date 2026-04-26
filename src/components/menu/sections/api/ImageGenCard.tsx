import { observer } from 'mobx-react-lite';
import { tokens } from '../../../../core/styleTokens';
import { useImageGenStore } from '../../../../stores/context';
import { Card, Pill, SettingsRow, Input, Select, SecretKeyField } from '../../../ui';
import { ProviderAvatar } from './ProviderAvatar';

export const ImageGenCard = observer(function ImageGenCard() {
  const store = useImageGenStore();
  const backend = store.backend;
  const connected = store.hasUsableBackend;

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
        <ProviderAvatar name="image" />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text)' }}>
            {backend === 'fal' && 'fal.ai (FLUX 2)'}
            {backend === 'bfl' && 'Black Forest Labs'}
            {backend === 'local-comfy' && 'ComfyUI (local)'}
            {backend === 'local-a1111' && 'AUTOMATIC1111 (local)'}
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
            onChange={e => store.setBackend(e.currentTarget.value as 'fal' | 'bfl' | 'local-comfy' | 'local-a1111')}
          >
            <option value="fal">fal.ai (cloud, FLUX 2)</option>
            <option value="local-comfy">ComfyUI (local)</option>
            <option value="local-a1111">AUTOMATIC1111 (local)</option>
            <option value="bfl" disabled>Black Forest Labs (soon)</option>
          </Select>
        </SettingsRow>

        {backend === 'fal' && <FalBackendFields />}
        {backend === 'local-comfy' && <ComfyBackendFields />}
        {backend === 'local-a1111' && <A1111BackendFields />}

        {(backend === 'local-comfy' || backend === 'local-a1111') && (
          <SettingsRow label="Cloud fallback" last>
            <Select
              value={store.config.fallbackBackend ?? ''}
              onChange={e => {
                const v = e.currentTarget.value;
                store.setFallbackBackend(v ? (v as 'fal' | 'bfl') : null);
              }}
            >
              <option value="">Disabled (errors surface to the model)</option>
              <option value="fal">fal.ai</option>
            </Select>
          </SettingsRow>
        )}
      </div>
    </Card>
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

const ComfyBackendFields = observer(function ComfyBackendFields() {
  const store = useImageGenStore();
  return (
    <>
      <SettingsRow label="Base URL">
        <Input
          placeholder="http://127.0.0.1:8188"
          value={store.config.comfyBaseUrl ?? ''}
          onChange={e => store.setComfyBaseUrl(e.currentTarget.value)}
          style={{ ...tokens.mono, fontSize: 12, flex: 1 }}
        />
      </SettingsRow>
      <SettingsRow label="Quality preset">
        <Select
          value={store.config.comfyQualityPreset ?? 'final'}
          onChange={e => store.setComfyQualityPreset(e.currentTarget.value as 'final' | 'draft')}
        >
          <option value="draft">Draft — SDXL Lightning 4-step</option>
          <option value="final">Final — custom / FLUX workflow</option>
        </Select>
      </SettingsRow>
      <SettingsRow label="Workflow template">
        <Input
          placeholder="(built-in SDXL default) · e.g. /workspace/notes/flux-workflow.json"
          value={store.config.comfyWorkflowPath ?? ''}
          onChange={e => store.setComfyWorkflowPath(e.currentTarget.value)}
          style={{ ...tokens.mono, fontSize: 12, flex: 1 }}
        />
      </SettingsRow>
      <div style={{ fontSize: 11.5, color: 'var(--text-faint)', paddingLeft: 8 }}>
        Draft mode expects <code style={tokens.mono}>sdxl_lightning_4step.safetensors</code> in ComfyUI checkpoints and ignores the custom workflow path. Final mode uses your workflow JSON with <code style={tokens.mono}>{'{{PROMPT}}'}</code>, <code style={tokens.mono}>{'{{WIDTH}}'}</code>, <code style={tokens.mono}>{'{{HEIGHT}}'}</code>, <code style={tokens.mono}>{'{{SEED}}'}</code> placeholders.
      </div>
    </>
  );
});

const A1111BackendFields = observer(function A1111BackendFields() {
  const store = useImageGenStore();
  const existingKey = store.config.a1111ApiKey ?? '';
  return (
    <>
      <SettingsRow label="Base URL">
        <Input
          placeholder="http://127.0.0.1:7860"
          value={store.config.a1111BaseUrl ?? ''}
          onChange={e => store.setA1111BaseUrl(e.currentTarget.value)}
          style={{ ...tokens.mono, fontSize: 12, flex: 1 }}
        />
      </SettingsRow>
      <SettingsRow label="API key (optional)">
        <SecretKeyField
          value={existingKey}
          onSet={(k) => store.setA1111Key(k)}
          onClear={() => store.setA1111Key('')}
          placeholder="Only if you started A1111 with --api-auth"
          connectLabel="Set"
        />
      </SettingsRow>
    </>
  );
});
