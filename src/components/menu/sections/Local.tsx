import { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { useBridgeStore, useImageGenStore, useLocalRuntimeStore, useOllamaStore } from '../../../stores/context';
import type { LocalRuntimeId, RuntimeState } from '../../../stores/LocalRuntimeStore';
import { Button, Card, Input, Pill, Select, SettingsRow, Toggle, SecretKeyField } from '../../ui';
import { ProviderAvatar } from './api/ProviderAvatar';

export const LocalSection = observer(function LocalSection() {
  const local = useLocalRuntimeStore();
  const bridge = useBridgeStore();
  const [logRuntime, setLogRuntime] = useState<LocalRuntimeId | null>(null);

  useEffect(() => {
    const timer = setInterval(() => {
      for (const id of ['ollama', 'comfyui'] as const) {
        const status = local.runtimes[id].status;
        if (status === 'starting' || status === 'online' || status === 'offline') void local.refreshStatus(id);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [local]);

  const logs = logRuntime ? local.runtimes[logRuntime].logs : [];

  return (
    <>
      <h1 style={tokens.h1}>Local</h1>
      <div style={tokens.kicker}>one place for Ollama, ComfyUI, and local vision</div>

      <RuntimeCard onOpenLogs={setLogRuntime} />
      <LocalLlmCard />
      <LocalImageCard />
      <LocalVisionCard />

      <Card style={{ marginTop: 18, padding: '14px 18px' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          GatesAI starts and stops the runtimes it manages. Install Ollama and ComfyUI first, then use Auto-detect here.
          Model files still come from the setup docs.
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <Button onClick={() => { void bridge.openWorkspacePath('/workspace/docs/gatesai-local-image-prereqs.md'); }}>
            Open image setup
          </Button>
          <Button onClick={() => { void bridge.openWorkspacePath('/workspace/docs/comfyui-setup.md'); }}>
            Open ComfyUI guide
          </Button>
        </div>
      </Card>

      {logRuntime && (
        <div
          onClick={() => setLogRuntime(null)}
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'grid', placeItems: 'center', zIndex: 30,
          }}
        >
          <Card
            onClick={e => e.stopPropagation()}
            style={{ width: 'min(760px, 88vw)', maxHeight: '72vh', overflow: 'hidden' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{runtimeLabel(logRuntime)} logs</div>
              <Button onClick={() => setLogRuntime(null)}>Close</Button>
            </div>
            <pre style={{
              margin: 0, maxHeight: '58vh', overflow: 'auto', padding: 12,
              background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
              color: 'var(--text-dim)', fontSize: 11.5, lineHeight: 1.5,
            }}>
              {logs.length ? logs.join('\n') : 'No logs captured yet.'}
            </pre>
          </Card>
        </div>
      )}
    </>
  );
});

const RuntimeCard = observer(function RuntimeCard({ onOpenLogs }: { onOpenLogs: (id: LocalRuntimeId) => void }) {
  const local = useLocalRuntimeStore();
  return (
    <Card style={{ marginBottom: 18 }}>
      <div style={cardHeaderStyle}>
        <ProviderAvatar name="local" />
        <div style={{ flex: 1 }}>
          <div style={cardTitleStyle}>Runtimes</div>
          <div style={cardDescStyle}>Auto-detect installs, start managed child processes, and keep their logs in one place.</div>
        </div>
        <Button onClick={() => { void local.autoDetect(); }} disabled={local.autoDetecting}>
          {local.autoDetecting ? 'Detecting…' : 'Auto-detect'}
        </Button>
      </div>

      <RuntimeRow id="ollama" runtime={local.runtimes.ollama} onOpenLogs={onOpenLogs} />
      <RuntimeRow id="comfyui" runtime={local.runtimes.comfyui} onOpenLogs={onOpenLogs} last />
    </Card>
  );
});

const RuntimeRow = observer(function RuntimeRow({ id, runtime, onOpenLogs, last }: {
  id: LocalRuntimeId;
  runtime: RuntimeState;
  onOpenLogs: (id: LocalRuntimeId) => void;
  last?: boolean;
}) {
  const local = useLocalRuntimeStore();
  const running = runtime.status === 'online' || runtime.status === 'starting' || runtime.status === 'offline';
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 14, alignItems: 'center',
      padding: '14px 0', borderTop: '1px solid var(--border)', borderBottom: last ? 'none' : undefined,
    }}>
      <div>
        <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{runtimeLabel(id)}</div>
        <div style={{ marginTop: 5 }}>{statusPill(runtime.status)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Input
          value={runtime.installPath}
          onChange={e => local.setInstallPath(id, e.currentTarget.value)}
          placeholder={id === 'ollama' ? 'C:\\Users\\you\\AppData\\Local\\Programs\\Ollama\\ollama.exe' : 'C:\\Users\\you\\ComfyUI\\ComfyUI_windows_portable'}
          style={{ ...tokens.mono, fontSize: 12 }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--text-faint)' }}>
          <Toggle on={runtime.managed} onChange={v => local.setManaged(id, v)} />
          Manage this process from GatesAI
          {runtime.pid && <span>pid {runtime.pid}</span>}
          {runtime.lastError && <span style={{ color: '#e57373' }}>{runtime.lastError}</span>}
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button onClick={() => { void local.browseFor(id); }}>Browse…</Button>
        <Button
          variant={running ? 'danger' : 'accent'}
          disabled={!runtime.managed}
          onClick={() => { void (running ? local.stop(id) : local.start(id)); }}
        >
          {running ? 'Stop' : 'Start'}
        </Button>
        <Button onClick={() => onOpenLogs(id)}>Logs</Button>
      </div>
    </div>
  );
});

const LocalLlmCard = observer(function LocalLlmCard() {
  const local = useLocalRuntimeStore();
  const ollama = useOllamaStore();
  const online = local.runtimes.ollama.status === 'online';
  return (
    <Card style={{ marginBottom: 18, opacity: online ? 1 : 0.72 }}>
      <div style={cardHeaderStyle}>
        <ProviderAvatar name="Ollama" />
        <div style={{ flex: 1 }}>
          <div style={cardTitleStyle}>Local LLMs</div>
          <div style={cardDescStyle}>Ollama model catalog, optional auth, and tool-call behavior.</div>
        </div>
        {online ? <Pill>● Online</Pill> : <Pill tone="muted">Start Ollama first</Pill>}
      </div>
      <SettingsRow label="Base URL">
        <Input value={local.ollamaBaseUrl} onChange={e => local.setBaseUrl('ollama', e.currentTarget.value)} style={{ ...tokens.mono, fontSize: 12 }} />
      </SettingsRow>
      <SettingsRow label="API key (optional)">
        <SecretKeyField
          value={ollama.config.apiKey ?? ''}
          onSet={k => ollama.setKey(k)}
          onClear={() => ollama.setKey('')}
          placeholder="Only if a reverse proxy is fronting Ollama with auth"
          connectLabel="Set"
        />
      </SettingsRow>
      <SettingsRow label="Tool calls">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Toggle on={ollama.config.toolsEnabled} onChange={v => ollama.setToolsEnabled(v)} />
          <span style={hintStyle}>Off if your local model behaves badly with tools.</span>
        </div>
      </SettingsRow>
      <SettingsRow label="Catalog" last>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ flex: 1, color: 'var(--text-faint)' }}>
            {ollama.count ? `${ollama.count} model${ollama.count === 1 ? '' : 's'} loaded` : 'No models loaded yet'}
          </span>
          <Button onClick={() => { void ollama.refresh(); }} disabled={!online || ollama.fetching}>
            {ollama.fetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </SettingsRow>
      <div style={footerHintStyle}>Run <code style={tokens.mono}>ollama pull llama3.1</code> to add a local chat model.</div>
    </Card>
  );
});

const LocalImageCard = observer(function LocalImageCard() {
  const local = useLocalRuntimeStore();
  const image = useImageGenStore();
  const online = local.runtimes.comfyui.status === 'online';
  return (
    <Card style={{ marginBottom: 18, opacity: online ? 1 : 0.72 }}>
      <div style={cardHeaderStyle}>
        <ProviderAvatar name="image" />
        <div style={{ flex: 1 }}>
          <div style={cardTitleStyle}>Local image generation</div>
          <div style={cardDescStyle}>ComfyUI workflows behind the same image_generate tool.</div>
        </div>
        {online ? <Pill>● Online</Pill> : <Pill tone="muted">Start ComfyUI first</Pill>}
      </div>
      <SettingsRow label="Base URL">
        <Input value={local.comfyBaseUrl} onChange={e => local.setBaseUrl('comfyui', e.currentTarget.value)} style={{ ...tokens.mono, fontSize: 12 }} />
      </SettingsRow>
      <SettingsRow label="Quality preset">
        <Select
          value={image.config.comfyQualityPreset ?? 'final'}
          onChange={e => image.setComfyQualityPreset(e.currentTarget.value as 'final' | 'draft')}
        >
          <option value="draft">Draft — SDXL quick prototype</option>
          <option value="final">Final — selected workflow template</option>
        </Select>
      </SettingsRow>
      <SettingsRow label="Workflow template">
        <Input
          placeholder="/workspace/scripts/comfy-workflows/current-final-workflow.json"
          value={image.config.comfyWorkflowPath ?? ''}
          onChange={e => image.setComfyWorkflowPath(e.currentTarget.value)}
          style={{ ...tokens.mono, fontSize: 12 }}
        />
      </SettingsRow>
      <SettingsRow label="Prompt enhancement">
        <Select
          value={image.config.promptEnhancement ?? 'off'}
          onChange={e => image.setPromptEnhancement(e.currentTarget.value as 'off' | 'llm')}
        >
          <option value="off">Off — use prompt exactly as written</option>
          <option value="llm">On — rewrite prompts for image models</option>
        </Select>
      </SettingsRow>
      {(image.config.promptEnhancement ?? 'off') === 'llm' && (
        <SettingsRow label="Style preset">
          <Select
            value={image.config.promptStylePreset ?? 'auto'}
            onChange={e => image.setPromptStylePreset(e.currentTarget.value as 'auto' | 'photorealistic' | 'concept-art' | 'abstract' | 'illustration')}
          >
            <option value="auto">Auto</option>
            <option value="photorealistic">Photorealistic</option>
            <option value="concept-art">Concept art</option>
            <option value="abstract">Abstract</option>
            <option value="illustration">Illustration</option>
          </Select>
        </SettingsRow>
      )}
      <SettingsRow label="Cloud fallback">
        <Select
          value={image.config.fallbackBackend ?? ''}
          onChange={e => image.setFallbackBackend(e.currentTarget.value ? 'fal' : null)}
        >
          <option value="">Disabled</option>
          <option value="fal">fal.ai</option>
        </Select>
      </SettingsRow>
      <SettingsRow label="Use for generation" last>
        <Button variant="accent" onClick={() => image.setBackend('local-comfy')} disabled={!online}>
          Set image_generate to ComfyUI
        </Button>
      </SettingsRow>
      <div style={footerHintStyle}>GatesAI appends the required CORS flags when it starts ComfyUI.</div>
    </Card>
  );
});

const LocalVisionCard = observer(function LocalVisionCard() {
  const local = useLocalRuntimeStore();
  const models = local.visionModels;
  return (
    <Card style={{ marginBottom: 18 }}>
      <div style={cardHeaderStyle}>
        <ProviderAvatar name="vision" />
        <div style={{ flex: 1 }}>
          <div style={cardTitleStyle}>Local vision</div>
          <div style={cardDescStyle}>A dedicated Ollama vision model for the describe_image tool.</div>
        </div>
        {local.visionModel ? <Pill>● Ready</Pill> : <Pill tone="muted">No model selected</Pill>}
      </div>
      <SettingsRow label="Vision model">
        <Select value={local.visionModel ?? ''} onChange={e => local.setVisionModel(e.currentTarget.value || undefined)}>
          <option value="">Choose a pulled vision model…</option>
          {models.map(m => (
            <option key={m.id} value={m.providerModelId}>{m.name}</option>
          ))}
        </Select>
      </SettingsRow>
      <SettingsRow label="Recommended pulls" last>
        <div style={{ display: 'grid', gap: 6 }}>
          <code style={tokens.mono}>ollama pull qwen2.5vl:7b</code>
          <code style={tokens.mono}>ollama pull llama3.2-vision</code>
        </div>
      </SettingsRow>
      <div style={footerHintStyle}>Any chat model can call <code style={tokens.mono}>describe_image</code>; it hands the image to this local vision model.</div>
    </Card>
  );
});

function statusPill(status: RuntimeState['status']) {
  switch (status) {
    case 'online': return <Pill>● Online</Pill>;
    case 'starting': return <Pill tone="muted">● Starting</Pill>;
    case 'offline': return <Pill tone="muted">○ Offline</Pill>;
    case 'crashed': return <Pill tone="muted">× Crashed</Pill>;
    case 'stopped':
    default: return <Pill tone="muted">○ Stopped</Pill>;
  }
}

function runtimeLabel(id: LocalRuntimeId): string {
  return id === 'ollama' ? 'Ollama' : 'ComfyUI';
}

const cardHeaderStyle = { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 };
const cardTitleStyle = { fontSize: 14, fontWeight: 500, color: 'var(--text)' };
const cardDescStyle = { fontSize: 11.5, color: 'var(--text-faint)', marginTop: 1 };
const hintStyle = { fontSize: 11.5, color: 'var(--text-faint)' };
const footerHintStyle = { ...hintStyle, paddingTop: 10, borderTop: '1px solid var(--border)' };
