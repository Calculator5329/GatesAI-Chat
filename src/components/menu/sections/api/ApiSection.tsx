// Renders API-provider controls for Api Section.
// Called by ApiSection or GatesMenu; depends on provider/search/image stores and shared form controls.
// Invariant: provider secrets and compatibility state are changed only through store actions.
import type { CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../../core/styleTokens';
import {
  useImageGenStore,
  useLocalRuntimeStore,
  useOllamaStore,
  useOpenRouterCompatibilityStore,
  useProviderStore,
  useRouterStore,
  useSearchStore,
} from '../../../../stores/context';
import { Button, Card, Pill, SecretKeyField } from '../../../ui';
import { ProviderCard, OPENROUTER_PROVIDER_INFO } from './ProviderCard';
import { ProviderAvatar } from './ProviderAvatar';

export const ApiSection = observer(function ApiSection() {
  const providers = useProviderStore();

  return (
    <>
      <h1 style={tokens.h1}>Models</h1>
      <div style={tokens.kicker}>Cloud model access - OpenRouter key - live catalog - web search</div>

      <Card style={{ padding: '14px 18px', marginBottom: 28, background: 'rgba(62,207,142,0.04)', borderColor: 'rgba(62,207,142,0.2)' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          This section configures optional cloud access: OpenRouter models, the live OpenRouter catalog, and Brave Search web grounding. Keys are stored in{' '}
          the OS credential store on desktop and <code style={tokens.mono}>localStorage</code> in the
          browser, and used only as the required request header for each provider.
        </div>
      </Card>

      <LocalModelsRow />
      <ProviderCard info={OPENROUTER_PROVIDER_INFO} providers={providers} />
      <OpenRouterCompatibilityCard />
      <BraveSearchCard />
      <OpenRouterImageGenerationCard />
    </>
  );
});

const LocalModelsRow = observer(function LocalModelsRow() {
  const local = useLocalRuntimeStore();
  const ollama = useOllamaStore();
  const router = useRouterStore();
  const online = local.runtimes.ollama.status === 'online';
  const status = online
    ? `Ollama online - ${ollama.count} model${ollama.count === 1 ? '' : 's'}`
    : 'Ollama not running';

  return (
    <Card style={{ ...localModelsRowStyle, marginBottom: 12 }}>
      <div style={{ minWidth: 0 }}>
        <div style={cardTitleStyle}>Local models</div>
        <div style={cardDescStyle}>{status}</div>
      </div>
      <Button onClick={() => router.goMenu('local')}>Open Local</Button>
    </Card>
  );
});

const OpenRouterCompatibilityCard = observer(function OpenRouterCompatibilityCard() {
  const compat = useOpenRouterCompatibilityStore();
  const disabledReason = !compat.openRouterReady
    ? 'Add an OpenRouter API key first.'
    : !compat.workspaceReady
      ? 'Start the workspace bridge first.'
      : undefined;
  const canRun = !compat.running && !disabledReason;

  return (
    <Card style={{ marginBottom: 12 }}>
      <div style={cardHeaderStyle}>
        <ProviderAvatar name="OpenRouter" />
        <div style={{ flex: 1 }}>
          <div style={cardTitleStyle}>Compatibility test suite</div>
          <div style={cardDescStyle}>Smoke-test OpenRouter models and write paste-ready logs to the workspace.</div>
        </div>
        {compat.running ? <Pill>Running</Pill> : compat.lastRun ? <Pill>{compat.lastRun.passed}/{compat.lastRun.total} passed</Pill> : <Pill tone="muted">Manual</Pill>}
      </div>

      <div style={compatPanelStyle}>
        <div style={compatButtonRowStyle}>
          <Button onClick={() => void compat.start('curated')} disabled={!canRun} title={disabledReason}>
            Curated ({compat.curatedCount})
          </Button>
          <Button onClick={() => void compat.start('sample')} disabled={!canRun} title={disabledReason}>
            Catalog sample ({compat.sampleCount})
          </Button>
          <Button variant="danger" onClick={() => void compat.start('all')} disabled={!canRun} title={disabledReason}>
            All catalog ({compat.allCount})
          </Button>
          {compat.running && (
            <Button variant="danger" onClick={() => compat.cancel()}>
              Cancel
            </Button>
          )}
        </div>

        <div style={compatStatusStyle}>
          {compat.running && compat.total > 0 ? `${compat.completed}/${compat.total} - ${compat.progress}` : compat.progress || disabledReason || 'Ready to run after adding an OpenRouter key.'}
        </div>
        {compat.lastRun && (
          <div style={compatPathStyle}>
            <div>Report: <code style={tokens.mono}>{compat.lastRun.reportPath}</code></div>
            <div>JSONL: <code style={tokens.mono}>{compat.lastRun.jsonlPath}</code></div>
          </div>
        )}
        {compat.lastError && <div style={compatErrorStyle}>{compat.lastError}</div>}
        {compat.logLines.length > 0 && (
          <pre style={compatLogStyle}>{compat.logLines.join('\n')}</pre>
        )}
      </div>
    </Card>
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
          Uses Brave LLM Context with up to 6 parallel searches per model tool call. Results are cached briefly to reduce duplicate requests.
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
const localModelsRowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '10px 12px',
};
const compatPanelStyle: CSSProperties = {
  paddingTop: 12,
  borderTop: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};
const compatButtonRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};
const compatStatusStyle: CSSProperties = { fontSize: 12, color: 'var(--text-dim)' };
const compatPathStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 11.5,
  color: 'var(--text-faint)',
};
const compatErrorStyle: CSSProperties = { fontSize: 12, color: '#ff7597' };
const compatLogStyle: CSSProperties = {
  margin: 0,
  padding: 10,
  maxHeight: 150,
  overflow: 'auto',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'rgba(255,255,255,0.02)',
  color: 'var(--text-dim)',
  fontSize: 11,
  lineHeight: 1.45,
  whiteSpace: 'pre-wrap',
};
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
