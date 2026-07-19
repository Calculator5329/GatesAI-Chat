// Route/notice banners that stack above the composer input. Each route-block
// banner links to the settings surface that would unblock sending; NoticeBanner
// is the generic dismissable notice used for persistence/compaction messages.
import { observer } from 'mobx-react-lite';
import { useEditorial } from '../../../stores/context';

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
      <span>Add an OpenRouter key in Models to start chatting.</span>
      <button
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
        Open models
      </button>
    </div>
  );
});

export const OllamaOfflineBanner = observer(function OllamaOfflineBanner() {
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
      <span>Start Ollama to chat with this local model.</span>
      <button
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
        Open local settings
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
          <button type="button" className="editorial-banner-action" onClick={props.onAction} style={{ fontSize: 12, color: 'var(--accent)' }}>
            {props.actionLabel}
          </button>
        )}
        <button type="button" className="editorial-banner-action" onClick={props.onDismiss} aria-label="Dismiss notice">×</button>
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
      <span>Start and connect ComfyUI to use local image generation.</span>
      <button
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
        Open local settings
      </button>
    </div>
  );
});
