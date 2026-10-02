// Route/notice banners that stack above the composer input. Each route-block
// banner links to the settings surface that would unblock sending; NoticeBanner
// is the generic dismissable notice used for persistence/compaction messages.
import type { CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { useEditorial } from '../../../stores/context';
import { isWebLite } from '../../../core/runtime';
import { missingLocalModelMessage } from '../../../core/localModelMeta';

export const ModelsKeyBanner = observer(function ModelsKeyBanner() {
  const { router } = useEditorial();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12,
      padding: '8px 12px',
      marginBottom: 8,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--panel)',
      color: 'var(--text-dim)',
      fontSize: 13,
      fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
    }}>
      <span>Please enter an OpenRouter API key to chat.</span>
      <button data-testid="workspace.composer-banners.open-models"
        type="button"
        className="editorial-banner-action"
        onClick={() => router.goMenu('models')}
        style={{
          padding: '4px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--accent)',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'inherit',
        }}
      >
        {isWebLite() ? 'Open settings' : 'Open models'}
      </button>
    </div>
  );
});

const BANNER_ACTION_STYLE: CSSProperties = {
  padding: '4px 10px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'transparent',
  color: 'var(--accent)',
  cursor: 'pointer',
  fontSize: 12,
  fontFamily: 'inherit',
};

/**
 * Follows the live Ollama probe and says what is wrong. While Ollama stays
 * down the probe backs off to every 5 minutes, so the banner offers Check
 * again; returning to the window also re-probes.
 */
export const OllamaOfflineBanner = observer(function OllamaOfflineBanner() {
  const { localRuntime, ollama, router } = useEditorial();
  const runtime = localRuntime.runtimes.ollama;
  const canRecheck = runtime.status !== 'unknown' && !isWebLite();
  const message = runtime.status === 'unknown'
    ? `Looking for Ollama at ${localRuntime.ollamaBaseUrl}...`
    : isWebLite()
      ? 'Local models need the GatesAI desktop app.'
      : `${runtime.lastError ?? `Nothing is answering at ${localRuntime.ollamaBaseUrl}.`} Start Ollama, then come back to this window or press Check again.`;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12,
      padding: '8px 12px',
      marginBottom: 8,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--panel)',
      color: 'var(--text-dim)',
      fontSize: 13,
      fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
    }}>
      <span>{message}</span>
      <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
        {canRecheck && (
          <button data-testid="workspace.composer-banners.recheck-ollama"
            type="button"
            className="editorial-banner-action"
            onClick={() => void ollama.refresh()}
            disabled={runtime.checking}
            style={BANNER_ACTION_STYLE}
          >
            {runtime.checking ? 'Checking...' : 'Check again'}
          </button>
        )}
        <button data-testid="workspace.composer-banners.open-local-settings"
          type="button"
          className="editorial-banner-action"
          onClick={() => router.goMenu('models')}
          style={BANNER_ACTION_STYLE}
        >
          Open Settings &gt; Models
        </button>
      </div>
    </div>
  );
});

/** A started chat stays on its local model after Ollama stops listing it; says so instead of a provider error. */
export const LocalModelMissingBanner = observer(function LocalModelMissingBanner() {
  const { chat, localRuntime, router } = useEditorial();
  const tag = chat.activeMissingLocalModelTag;
  if (!tag) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12,
      padding: '8px 12px',
      marginBottom: 8,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--panel)',
      color: 'var(--text-dim)',
      fontSize: 13,
      fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
    }}>
      <span>{missingLocalModelMessage(tag, localRuntime.ollamaBaseUrl)}</span>
      <button data-testid="workspace.composer-banners.open-models-for-missing-local-model"
        type="button"
        className="editorial-banner-action"
        onClick={() => router.goMenu('models')}
        style={{
          padding: '4px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--accent)',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'inherit',
        }}
      >
        Open Settings &gt; Models
      </button>
    </div>
  );
});

export function NoticeBanner(props: {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="chat-error-banner" role="status" style={{ marginBottom: 8 }}>
      <span>{props.message}</span>
      <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        {props.actionLabel && props.onAction && (
          <button data-testid="workspace.composer-banners.editorial-banner-action" type="button" className="editorial-banner-action" onClick={props.onAction} style={{ fontSize: 12, color: 'var(--accent)' }}>
            {props.actionLabel}
          </button>
        )}
        <button data-testid="workspace.composer-banners.dismiss-notice" type="button" className="editorial-banner-action" onClick={props.onDismiss} aria-label="Dismiss notice">×</button>
      </span>
    </div>
  );
}

export const LocalImageBanner = observer(function LocalImageBanner() {
  const { router } = useEditorial();
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 12,
      padding: '8px 12px',
      marginBottom: 8,
      border: '1px solid var(--border)',
      borderRadius: 8,
      background: 'var(--panel)',
      color: 'var(--text-dim)',
      fontSize: 13,
      fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
    }}>
      <span>Start ComfyUI or ComfyUI Desktop to use local image generation; GatesAI finds it on its own.</span>
      <button data-testid="workspace.composer-banners.open-local-image-settings"
        type="button"
        className="editorial-banner-action"
        onClick={() => router.goMenu('models')}
        style={{
          padding: '4px 10px',
          border: '1px solid var(--border)',
          borderRadius: 6,
          background: 'transparent',
          color: 'var(--accent)',
          cursor: 'pointer',
          fontSize: 12,
          fontFamily: 'inherit',
        }}
      >
        Open Settings &gt; Models
      </button>
    </div>
  );
});
