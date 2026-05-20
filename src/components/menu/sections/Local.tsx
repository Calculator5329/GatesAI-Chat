// Renders the Local menu section and the controls for its store-backed workflow.
// Called by GatesMenu; depends on MobX stores, bridge services, and shared UI primitives.
// Invariant: menu components present state and delegate side effects to stores/services.
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { useBridgeStore, useImageGenStore, useLocalRuntimeStore, useOllamaStore } from '../../../stores/context';
import type { LocalRuntimeId, RuntimeState } from '../../../stores/LocalRuntimeStore';
import { Button, Card, Input, Pill, Select, SettingsRow, Toggle, SecretKeyField } from '../../ui';
import { ProviderAvatar } from './api/ProviderAvatar';
import { WebLiteNotice } from '../../ui/WebLiteNotice';
import { isWebLite } from '../../../services/system/runtime';

export const LocalSection = observer(function LocalSection() {
  const local = useLocalRuntimeStore();
  const bridge = useBridgeStore();
  const [logRuntime, setLogRuntime] = useState<LocalRuntimeId | null>(null);
  const webLite = isWebLite();

  // Eagerly refresh both runtimes on first paint so we don't show stale
  // 'stopped' chips while the underlying service is actually online.
  useEffect(() => {
    if (webLite) return;
    local.refreshAll();
    const timer = setInterval(() => {
      for (const id of ['ollama', 'comfyui'] as const) {
        const status = local.runtimes[id].status;
        if (status === 'starting' || status === 'online' || status === 'offline') void local.refreshStatus(id);
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [local, webLite]);

  useEffect(() => {
    if (!logRuntime) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLogRuntime(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [logRuntime]);

  if (webLite) {
    return (
      <>
        <h1 style={tokens.h1}>Local</h1>
        <div style={tokens.kicker}>desktop runtimes</div>
        <WebLiteNotice show={webLite}>
          <strong style={{ color: 'var(--text)' }}>Web Lite:</strong>{' '}
          Ollama, ComfyUI, local vision, and managed runtime controls are desktop-only.
          Use Models for OpenRouter/API chat in the hosted web app.
        </WebLiteNotice>
        <Card style={{ marginTop: 18, padding: '16px 18px' }}>
          <div style={{ color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.55 }}>
            The Firebase-hosted app runs entirely in the browser for now. A future cloud backend can add server-side tools,
            cloud artifact storage, and hosted image generation without requiring a local bridge.
          </div>
        </Card>
      </>
    );
  }

  return (
    <>
      <h1 style={tokens.h1}>Local</h1>
      <div style={tokens.kicker}>installed runtimes · Ollama · ComfyUI · local vision</div>
        <WebLiteNotice show={webLite}>
        <strong style={{ color: 'var(--text)' }}>Web Lite:</strong>{' '}
        local runtimes are desktop-only. Use Models for OpenRouter/API chat in the hosted web app.
      </WebLiteNotice>

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

      {logRuntime && <LogModal runtimeId={logRuntime} onClose={() => setLogRuntime(null)} />}

      <style>{`
        @keyframes localStartingPulse {
          0%   { opacity: 0.4; }
          50%  { opacity: 1;   }
          100% { opacity: 0.4; }
        }
      `}</style>
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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
          <Button onClick={() => { void local.autoDetect(); }} disabled={local.autoDetecting}>
            {local.autoDetecting ? 'Detecting…' : 'Auto-detect'}
          </Button>
          {local.autoDetectAt && (
            <span style={{ fontSize: 10.5, color: 'var(--text-faint)' }} title={new Date(local.autoDetectAt).toLocaleString()}>
              last run {formatRelativeTime(local.autoDetectAt)} · safe to re-run
            </span>
          )}
        </div>
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
  const bridge = useBridgeStore();
  const running = runtime.status === 'online' || runtime.status === 'starting';
  const showInstallHint = local.autoDetectComplete && !runtime.installPath;
  const startDisabledReason = !runtime.managed
    ? 'Enable "Manage this process from GatesAI" first.'
    : !runtime.installPath
      ? `Choose ${id === 'ollama' ? 'an Ollama executable' : 'a ComfyUI portable folder'} first.`
      : undefined;
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '120px 1fr auto', gap: 14, alignItems: 'start',
      padding: '14px 0', borderTop: '1px solid var(--border)', borderBottom: last ? 'none' : undefined,
    }}>
      <div style={{ paddingTop: 4 }}>
        <div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500 }}>{runtimeLabel(id)}</div>
        <div style={{ marginTop: 5 }}>{statusPill(runtime.status, runtime.pid)}</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Input
          value={runtime.installPath}
          onChange={e => local.setInstallPath(id, e.currentTarget.value)}
          placeholder={id === 'ollama' ? 'C:\\Users\\you\\AppData\\Local\\Programs\\Ollama\\ollama.exe' : 'C:\\Users\\you\\ComfyUI\\ComfyUI_windows_portable'}
          style={{ ...tokens.mono, fontSize: 12 }}
        />
        {showInstallHint && (
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
            Auto-detect couldn't find {runtimeLabel(id)} on this machine. {' '}
            <button
              type="button"
              onClick={() => { void bridge.openWorkspacePath(id === 'ollama' ? '/workspace/docs/gatesai-local-image-prereqs.md' : '/workspace/docs/comfyui-setup.md'); }}
              style={inlineLinkStyle}
            >
              Open setup guide
            </button>
            {' '}or use Browse… below.
          </div>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11.5, color: 'var(--text-faint)' }}>
          <Toggle on={runtime.managed} onChange={v => local.setManaged(id, v)} />
          Manage this process from GatesAI
        </div>
        {runtime.lastError && (
          <div role="alert" style={errorRowStyle}>
            <span style={{ flex: 1 }}>{runtime.lastError}</span>
            {runtime.logs.length > 0 && (
              <button type="button" onClick={() => onOpenLogs(id)} style={inlineLinkStyle}>
                View logs
              </button>
            )}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, paddingTop: 4 }}>
        <Button onClick={() => { void local.browseFor(id); }}>Browse…</Button>
        <Button
          variant={running ? 'danger' : 'accent'}
          disabled={!running && !!startDisabledReason}
          title={running ? 'Stop this managed process' : startDisabledReason}
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
  const status = local.runtimes.ollama.status;
  const online = status === 'online';
  return (
    <Card style={{ marginBottom: 18 }}>
      <div style={cardHeaderStyle}>
        <ProviderAvatar name="Ollama" />
        <div style={{ flex: 1 }}>
          <div style={cardTitleStyle}>Local LLMs</div>
          <div style={cardDescStyle}>Ollama model catalog, optional auth, and tool-call behavior.</div>
        </div>
        {sectionPill(status, 'Ollama')}
      </div>
      <SettingsRow label="Base URL">
        <BaseUrlField id="ollama" />
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
            {!online
              ? 'Start Ollama to load the catalog.'
              : ollama.count
                ? `${ollama.count} model${ollama.count === 1 ? '' : 's'} loaded`
                : 'No models pulled yet — run an `ollama pull` to add one.'}
          </span>
          <Button
            onClick={() => { void ollama.refresh(); }}
            disabled={!online || ollama.fetching}
            title={!online ? 'Start Ollama before refreshing the catalog.' : undefined}
          >
            {ollama.fetching ? 'Refreshing…' : 'Refresh'}
          </Button>
        </div>
      </SettingsRow>
      <PullSnippet command="ollama pull llama3.1" hint="Add a local chat model." />
    </Card>
  );
});

const LocalImageCard = observer(function LocalImageCard() {
  const local = useLocalRuntimeStore();
  const image = useImageGenStore();
  const status = local.runtimes.comfyui.status;
  const online = status === 'online';
  const isActiveBackend = image.effectiveBackend === 'local-comfy';
  const preset = image.config.comfyQualityPreset ?? 'full';
  const upscale = image.config.comfyUpscaleFactor ?? 1;
  return (
    <Card style={{ marginBottom: 18 }}>
      <div style={cardHeaderStyle}>
        <ProviderAvatar name="image" />
        <div style={{ flex: 1 }}>
          <div style={cardTitleStyle}>Local image generation</div>
          <div style={cardDescStyle}>Draft, Normal, and Upscale ComfyUI modes behind image_generate.</div>
        </div>
        {sectionPill(status, 'ComfyUI')}
      </div>
      <SettingsRow label="Base URL">
        <BaseUrlField id="comfyui" />
      </SettingsRow>
      <SettingsRow label="Default local mode">
        <Select
          value={preset}
          onChange={e => image.setComfyQualityPreset(e.currentTarget.value as 'full' | 'quick')}
        >
          <option value="quick">Draft — SDXL Lightning, native resolution</option>
          <option value="full">Normal — FLUX.2 Klein, optional upscale</option>
        </Select>
      </SettingsRow>
      {preset === 'full' && (
        <>
          <SettingsRow label="Flux upscale">
            <Select
              value={String(upscale)}
              onChange={e => image.setComfyUpscaleFactor(Number(e.currentTarget.value) as 1 | 1.5 | 2 | 2.5 | 3)}
            >
              <option value="1">Normal — no upscale (~1-2s)</option>
              <option value="1.5">Upscale — 1.5× hires-fix (~+1-2s)</option>
              <option value="2">Upscale — 2× hires-fix (~+2-3s, recommended)</option>
              <option value="2.5">Upscale — 2.5× hires-fix (~+3-5s)</option>
              <option value="3">Upscale — 3× hires-fix (~+5-8s, may soften)</option>
            </Select>
          </SettingsRow>
          <SettingsRow label="Workflow template">
            <Input
              placeholder="leave blank for built-in FLUX.2 Klein; or /workspace/scripts/comfy-workflows/yours.json"
              value={image.config.comfyWorkflowPath ?? ''}
              onChange={e => image.setComfyWorkflowPath(e.currentTarget.value)}
              style={{ ...tokens.mono, fontSize: 12 }}
            />
          </SettingsRow>
        </>
      )}
      <SettingsRow label="Use for generation" last>
        {isActiveBackend ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pill>● Active backend</Pill>
            <span style={hintStyle}>image_generate is routing to ComfyUI.</span>
          </div>
        ) : (
          <Button
            variant="accent"
            onClick={() => image.setBackend('local-comfy')}
            disabled={!online}
            title={!online ? 'Start ComfyUI before routing image_generate to it.' : undefined}
          >
            Set image_generate to ComfyUI
          </Button>
        )}
      </SettingsRow>
      <div style={footerHintStyle}>GatesAI appends the required CORS flags when it starts ComfyUI.</div>
    </Card>
  );
});

const LocalVisionCard = observer(function LocalVisionCard() {
  const local = useLocalRuntimeStore();
  const ollamaOnline = local.runtimes.ollama.status === 'online';
  const ready = !!local.visionModel && ollamaOnline;
  const models = local.visionModels;
  return (
    <Card style={{ marginBottom: 18 }}>
      <div style={cardHeaderStyle}>
        <ProviderAvatar name="vision" />
        <div style={{ flex: 1 }}>
          <div style={cardTitleStyle}>Local vision</div>
          <div style={cardDescStyle}>A dedicated Ollama vision model for the describe_image tool.</div>
        </div>
        {ready
          ? <Pill>● Ready</Pill>
          : local.visionModel
            ? <Pill tone="muted" title="Vision model is selected but Ollama is not online.">● Ollama offline</Pill>
            : <Pill tone="muted">No model selected</Pill>}
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
          <PullSnippet command="ollama pull qwen2.5vl:7b" />
          <PullSnippet command="ollama pull llama3.2-vision" />
        </div>
      </SettingsRow>
      <div style={footerHintStyle}>Any chat model can call <code style={tokens.mono}>describe_image</code>; it hands the image to this local vision model.</div>
    </Card>
  );
});

const BaseUrlField = observer(function BaseUrlField({ id }: { id: LocalRuntimeId }) {
  const local = useLocalRuntimeStore();
  const value = id === 'ollama' ? local.ollamaBaseUrl : local.comfyBaseUrl;
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null);

  // Clear the inline result when the user edits the URL again.
  const onChange = (next: string) => {
    if (result) setResult(null);
    local.setBaseUrl(id, next);
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    const r = await local.testConnection(id);
    setTesting(false);
    setResult(r.ok ? { ok: true, msg: 'Reachable.' } : { ok: false, msg: r.error });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, width: '100%' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <Input
          value={value}
          onChange={e => onChange(e.currentTarget.value)}
          style={{ ...tokens.mono, fontSize: 12, flex: 1 }}
        />
        <Button onClick={test} disabled={testing} title={`Probe ${id === 'ollama' ? '/api/version' : '/system_stats'} on the URL above.`}>
          {testing ? 'Testing…' : 'Test'}
        </Button>
      </div>
      {result && (
        <span style={{ fontSize: 11.5, color: result.ok ? 'var(--accent)' : '#e57373' }}>
          {result.ok ? '✓ ' : '✗ '}{result.msg}
        </span>
      )}
    </div>
  );
});

const PullSnippet = observer(function PullSnippet({ command, hint }: { command: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore — older browsers / non-secure contexts
    }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5, color: 'var(--text-faint)' }}>
      <code style={{ ...tokens.mono, flex: 'none' }}>{command}</code>
      <button type="button" onClick={onCopy} style={inlineLinkStyle} title="Copy command">
        {copied ? 'copied' : 'copy'}
      </button>
      {hint && <span style={{ flex: 1 }}>{hint}</span>}
    </div>
  );
});

const LogModal = observer(function LogModal({ runtimeId, onClose }: { runtimeId: LocalRuntimeId; onClose: () => void }) {
  const local = useLocalRuntimeStore();
  const logs = local.runtimes[runtimeId].logs;
  const status = local.runtimes[runtimeId].status;
  const pid = local.runtimes[runtimeId].pid;
  const [follow, setFollow] = useState(true);
  const [copied, setCopied] = useState(false);
  const preRef = useRef<HTMLPreElement | null>(null);

  // When following the tail, pin the scroll to the bottom on every new
  // line. Detach if the user scrolls up so we don't fight them.
  useEffect(() => {
    if (!follow) return;
    const el = preRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [follow, logs]);

  const text = useMemo(() => logs.join('\n'), [logs]);
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  };
  const onScroll = () => {
    const el = preRef.current;
    if (!el || !follow) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (distanceFromBottom > 32) setFollow(false);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
        display: 'grid', placeItems: 'center', zIndex: 30,
      }}
    >
      <Card
        onClick={e => e.stopPropagation()}
        style={{ width: 'min(760px, 88vw)', maxHeight: '72vh', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>
            {runtimeLabel(runtimeId)} logs
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-faint)' }}>
              {status}{pid ? ` · pid ${pid}` : ''}
            </span>
          </div>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: 'var(--text-faint)' }}>
            <Toggle on={follow} onChange={setFollow} />
            Follow tail
          </label>
          <Button onClick={onCopy} disabled={!logs.length}>{copied ? 'Copied' : 'Copy'}</Button>
          <Button onClick={onClose}>Close</Button>
        </div>
        <pre
          ref={preRef}
          onScroll={onScroll}
          style={{
            margin: 0, maxHeight: '58vh', overflow: 'auto', padding: 12,
            background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8,
            color: 'var(--text-dim)', fontSize: 11.5, lineHeight: 1.5,
          }}
        >
          {logs.length ? text : 'No logs captured yet.'}
        </pre>
      </Card>
    </div>
  );
});

function statusPill(status: RuntimeState['status'], pid?: number) {
  const tooltip = pid ? `pid ${pid}` : undefined;
  switch (status) {
    case 'online':   return <Pill title={tooltip}>● Online</Pill>;
    case 'starting': return <Pill tone="muted" title={tooltip}><AnimatedDot /> Starting</Pill>;
    case 'crashed':  return <Pill tone="danger" title={tooltip}>× Crashed</Pill>;
    case 'offline':  return <Pill tone="warning" title="Process is up but the health check isn't answering — open Logs to investigate.">○ Offline</Pill>;
    case 'stopped':
    default:         return <Pill tone="muted">○ Stopped</Pill>;
  }
}

function sectionPill(status: RuntimeState['status'], runtime: string) {
  if (status === 'online')   return <Pill>● Online</Pill>;
  if (status === 'starting') return <Pill tone="muted"><AnimatedDot /> Starting…</Pill>;
  if (status === 'crashed')  return <Pill tone="danger">× {runtime} crashed</Pill>;
  if (status === 'offline')  return <Pill tone="warning">○ {runtime} not answering</Pill>;
  return <Pill tone="muted">Start {runtime} first</Pill>;
}

function AnimatedDot() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
        background: 'currentColor',
        animation: 'localStartingPulse 1.1s ease-in-out infinite',
      }}
    />
  );
}

function runtimeLabel(id: LocalRuntimeId): string {
  return id === 'ollama' ? 'Ollama' : 'ComfyUI';
}

function formatRelativeTime(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.round(delta / 3_600_000)}h ago`;
  return `${Math.round(delta / 86_400_000)}d ago`;
}

const cardHeaderStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 };
const cardTitleStyle: CSSProperties = { fontSize: 14, fontWeight: 500, color: 'var(--text)' };
const cardDescStyle: CSSProperties = { fontSize: 11.5, color: 'var(--text-faint)', marginTop: 1 };
const hintStyle: CSSProperties = { fontSize: 11.5, color: 'var(--text-faint)' };
const footerHintStyle: CSSProperties = { ...hintStyle, paddingTop: 10, borderTop: '1px solid var(--border)' };
const inlineLinkStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--accent)',
  cursor: 'pointer',
  fontSize: 'inherit',
  padding: 0,
  textDecoration: 'underline',
};
const errorRowStyle: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 10,
  padding: '6px 8px', borderRadius: 4,
  background: 'rgba(229,115,115,0.08)',
  border: '1px solid rgba(229,115,115,0.25)',
  color: '#e57373',
  fontSize: 11.5, lineHeight: 1.4,
};
