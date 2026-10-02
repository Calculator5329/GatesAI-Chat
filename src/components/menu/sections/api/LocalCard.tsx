// Renders the Local card at the top of Settings > Models: chat (Ollama), images
// (ComfyUI) and memory (embeddings), each with live status and one next step.
// Called by ApiSection on desktop only; depends on the local-runtime and Ollama stores.
// Invariant: status comes from LocalRuntimeStore's probes; this card never probes on its own schedule.
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { isLoopbackBaseUrl } from '../../../../core/localUrls';
import { tokens } from '../../../../core/styleTokens';
import { useLocalRuntimeStore, useOllamaStore } from '../../../../stores/context';
import type { LocalRuntimeStore } from '../../../../stores/LocalRuntimeStore';
import { Button, Card, Input, Pill, SecretKeyField, Toggle } from '../../../ui';
import { ProviderAvatar } from './ProviderAvatar';

const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';
const COMFY_GUIDE_URL = 'https://github.com/Calculator5329/GatesAI-Chat/blob/master/docs/comfyui-setup.md';
const STARTER_MODEL = { name: 'qwen3.5:4b', size: '3.4 GB' };
const EMBED_MODEL = { name: 'nomic-embed-text', size: '274 MB' };

type ComfyPreset = NonNullable<LocalRuntimeStore['comfyDiscovery']>['preset'];

export const LocalCard = observer(function LocalCard() {
  const local = useLocalRuntimeStore();
  const ollama = useOllamaStore();
  const chatReady = ollama.online && ollama.count > 0;
  const looking = local.runtimes.ollama.status === 'unknown';

  return (
    <Card style={{ marginBottom: 12 }} data-testid="settings.models.local-card">
      <div style={headerStyle}>
        <ProviderAvatar name="Local" />
        <div style={{ flex: 1 }}>
          <div style={titleStyle}>Local</div>
          <div style={descStyle}>Chat, images and memory on your own hardware. No account, no key.</div>
        </div>
        {chatReady
          ? <Pill>● Ready</Pill>
          : looking ? <Pill tone="muted">Looking…</Pill> : <Pill tone="warning">Needs Ollama</Pill>}
      </div>
      <div style={bodyStyle}>
        <ChatRow />
        <ImagesRow />
        <MemoryRow />
        <Row label="New chats" last>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle
              testId="settings.local-card.prefer-local"
              label="Start new chats on a local model"
              on={local.preferLocalModels}
              onChange={next => local.setPreferLocalModels(next)}
            />
            <span style={{ fontSize: 13, color: 'var(--text)' }}>Start new chats on a local model</span>
          </div>
          <div style={hintStyle}>
            Used whenever a local chat model is installed, even if you also have a cloud key.
            Chats you already started keep their model.
          </div>
        </Row>
      </div>
    </Card>
  );
});

const ChatRow = observer(function ChatRow() {
  const local = useLocalRuntimeStore();
  const ollama = useOllamaStore();
  const runtime = local.runtimes.ollama;
  const [draft, setDraft] = useState(local.ollamaBaseUrl);
  useEffect(() => {
    setDraft(local.ollamaBaseUrl);
  }, [local.ollamaBaseUrl]);

  // A changed address probes on its own (LocalRuntimeStore.setBaseUrl); the
  // same address means "check again".
  const commit = (): void => {
    const before = local.ollamaBaseUrl;
    local.setBaseUrl('ollama', draft);
    if (local.ollamaBaseUrl === before) void ollama.refresh();
  };
  const remote = !isLoopbackBaseUrl(local.ollamaBaseUrl);
  const apiKey = ollama.config.apiKey ?? '';

  return (
    <Row label="Chat">
      <Status
        tone={runtime.status === 'online' ? 'ok' : runtime.status === 'unknown' ? 'pending' : 'off'}
        text={runtime.status === 'online'
          ? `Ollama · ${ollama.count} chat model${ollama.count === 1 ? '' : 's'}`
          : runtime.status === 'unknown'
            ? `Looking for Ollama at ${runtime.baseUrl}…`
            : runtime.lastError ?? `Nothing is answering at ${runtime.baseUrl}.`}
      />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Input data-testid="settings.models-api-section.http-127-0-0-1-11434"
          aria-label="Ollama address"
          value={draft}
          onChange={e => setDraft(e.currentTarget.value)}
          onKeyDown={e => { if (e.key === 'Enter') commit(); }}
          placeholder="http://127.0.0.1:11434"
          style={{ flex: 1, minWidth: 220 }}
        />
        <Button data-testid="settings.models-api-section.commit" onClick={commit} disabled={runtime.checking}>
          {runtime.checking ? 'Checking…' : 'Check now'}
        </Button>
      </div>
      {(remote || apiKey) && (
        <SecretKeyField
          identityKey="ollama"
          value={apiKey}
          onSet={key => ollama.setKey(key)}
          onClear={() => ollama.setKey('')}
          placeholder="API key, only if your server asks for one…"
          connectLabel="Save"
        />
      )}
      {runtime.status === 'offline' && !remote && (
        <div style={hintStyle}>
          <a data-testid="settings.local-card.install-ollama" href={OLLAMA_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" style={linkStyle}>
            Install Ollama
          </a>
          {' '}and start it; GatesAI checks again when you switch back to this window. Ollama on another computer? Type its
          address above, for example <code style={tokens.mono}>192.168.1.20</code> or{' '}
          <code style={tokens.mono}>https://ollama.example.com</code>.
        </div>
      )}
      {runtime.status === 'offline' && remote && (
        <div style={hintStyle}>
          On the server, Ollama has to listen beyond localhost: set{' '}
          <code style={tokens.mono}>OLLAMA_HOST=0.0.0.0:11434</code> and restart it.
        </div>
      )}
      {runtime.status === 'online' && ollama.count === 0 && (
        <PullAction model={STARTER_MODEL} testId="settings.local-card.pull-starter" cancelTestId="settings.local-card.pull-starter-cancel"
          note="A small model that can use tools, read images and think step by step." />
      )}
    </Row>
  );
});

const ImagesRow = observer(function ImagesRow() {
  const local = useLocalRuntimeStore();
  const discovery = local.comfyDiscovery;
  const runtime = local.runtimes.comfyui;
  const guide = (
    <a data-testid="settings.local-card.comfy-guide" href={COMFY_GUIDE_URL} target="_blank" rel="noopener noreferrer" style={linkStyle}>
      Setup guide
    </a>
  );

  let status: ReactNode;
  let next: ReactNode = null;
  if (discovery?.online && discovery.preset) {
    status = <Status tone="ok" text={`ComfyUI · ${presetLabel(discovery.preset)} · ${discovery.baseUrl}`} />;
  } else if (discovery?.online) {
    status = <Status tone="off" text={`ComfyUI is running at ${discovery.baseUrl} but has no image model GatesAI can use.`} />;
    next = <div style={hintStyle}>Add one model to it. {guide}</div>;
  } else if (runtime.status === 'unknown') {
    status = <Status tone="pending" text="Looking for ComfyUI…" />;
  } else {
    status = <Status tone="off" text="ComfyUI not found on port 8188 or 8000." />;
    next = (
      <div style={hintStyle}>
        Start ComfyUI or ComfyUI Desktop and GatesAI finds it. Until then, images use OpenRouter when you have a key. {guide}
      </div>
    );
  }

  return (
    <Row label="Images">
      {status}
      {next}
    </Row>
  );
});

const MemoryRow = observer(function MemoryRow() {
  const ollama = useOllamaStore();
  return (
    <Row label="Memory">
      {!ollama.online ? (
        <Status tone="off" text={`Recall across chats uses ${EMBED_MODEL.name} through Ollama.`} />
      ) : ollama.hasModelTag(EMBED_MODEL.name) ? (
        <Status tone="ok" text={`${EMBED_MODEL.name} installed. Recall across chats runs locally.`} />
      ) : (
        <>
          <Status tone="off" text={`Recall across chats needs ${EMBED_MODEL.name}.`} />
          <PullAction model={EMBED_MODEL} testId="settings.local-card.pull-embed" cancelTestId="settings.local-card.pull-embed-cancel" />
        </>
      )}
    </Row>
  );
});

/** One-click `ollama pull` with live progress, cancel and the failure reason. */
const PullAction = observer(function PullAction({ model, testId, cancelTestId, note }: {
  model: { name: string; size: string };
  testId: string;
  // Literal, not derived from testId, so the testid registry scanner can see it.
  cancelTestId: string;
  note?: string;
}) {
  const ollama = useOllamaStore();
  const state = ollama.pulls.get(model.name);
  const pulling = ollama.isPulling(model.name);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {pulling ? (
          <>
            <span style={{ ...hintStyle, fontFamily: '"Geist Mono", monospace' }}>
              {state?.phase ?? 'Downloading'} · {Math.round(state?.percent ?? 0)}%
            </span>
            <Button data-testid={cancelTestId} onClick={() => ollama.cancelPull(model.name)}>Cancel</Button>
          </>
        ) : (
          <Button data-testid={testId} onClick={() => { void ollama.startPull(model.name); }} disabled={ollama.activePullModel !== null}>
            Download {model.name} ({model.size})
          </Button>
        )}
      </div>
      {note && !pulling && <div style={hintStyle}>{note}</div>}
      {state?.error && !pulling && <div role="alert" style={{ fontSize: 11.5, color: 'var(--danger)' }}>{state.error}</div>}
    </div>
  );
});

function Row({ label, last, children }: { label: string; last?: boolean; children: ReactNode }) {
  return (
    <div style={{ ...rowStyle, borderBottom: last ? 'none' : rowStyle.borderBottom, paddingBottom: last ? 0 : rowStyle.paddingBottom }}>
      <div style={rowLabelStyle}>{label}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>{children}</div>
    </div>
  );
}

function Status({ tone, text }: { tone: 'ok' | 'pending' | 'off'; text: string }) {
  const color = tone === 'ok' ? 'var(--accent)' : tone === 'pending' ? 'var(--text-faint)' : 'var(--warning-2)';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 13, color: 'var(--text)', overflowWrap: 'anywhere' }}>
      <span aria-hidden style={{ color, fontSize: 10 }}>●</span>
      <span>{text}</span>
    </div>
  );
}

function presetLabel(preset: NonNullable<ComfyPreset>): string {
  switch (preset.kind) {
    case 'flux2-klein': return 'FLUX.2 Klein';
    case 'sdxl-lightning': return 'SDXL Lightning';
    case 'checkpoint': return preset.checkpoint.split(/[\\/]/).pop()?.replace(/\.(safetensors|ckpt)$/i, '') ?? preset.checkpoint;
  }
}

const headerStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 };
const titleStyle: CSSProperties = { fontSize: 14, fontWeight: 500, color: 'var(--text)' };
const descStyle: CSSProperties = { fontSize: 11.5, color: 'var(--text-faint)', marginTop: 1 };
const hintStyle: CSSProperties = { fontSize: 11.5, color: 'var(--text-faint)', lineHeight: 1.5 };
const linkStyle: CSSProperties = { color: 'var(--accent)' };
const bodyStyle: CSSProperties = { borderTop: '1px solid var(--border)' };
const rowStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '88px minmax(0, 1fr)',
  gap: 16,
  paddingTop: 12,
  paddingBottom: 12,
  borderBottom: '1px solid var(--border)',
};
const rowLabelStyle: CSSProperties = { fontSize: 12.5, color: 'var(--text-dim)', paddingTop: 1 };
