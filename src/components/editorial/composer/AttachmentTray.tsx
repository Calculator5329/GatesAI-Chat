// The status stack shown directly above the composer input row: attachment
// chips (image thumbnails or filename pills), a vision-capability warning when
// an image is attached to a text-only model, and the upload progress/error
// line. Presentational — all state is handed in as props by EditorialComposer.
import { isImageMime } from '../../../core/attachments';
import { modelSupportsVision } from '../../../core/modelCapabilities';
import type { DraftAttachment, Model } from '../../../core/types';
import { WorkspaceImage } from '../WorkspaceImage';
import { hasImageAttachment } from './composerAttachments';

interface AttachmentTrayProps {
  attachments: DraftAttachment[];
  currentModel: Model | undefined;
  uploading: boolean;
  uploadError: string | null;
  onRemove: (id: string) => void;
}

export function AttachmentTray({
  attachments,
  currentModel,
  uploading,
  uploadError,
  onRemove,
}: AttachmentTrayProps) {
  const hasAttachments = attachments.length > 0;
  return (
    <>
      {hasAttachments && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8, alignItems: 'center' }}>
          {attachments.map(a => (
            isImageMime(a.mime) ? (
              <span
                key={a.id}
                style={{ position: 'relative', display: 'inline-block' }}
                title={a.filename}
              >
                <WorkspaceImage path={a.path} alt={a.filename} kind={a.filename.split('.').pop()?.toUpperCase() || 'IMG'} cacheKey={a.id} />
                <button
                  type="button"
                  className="composer-attachment-remove"
                  onClick={() => onRemove(a.id)}
                  title="Remove"
                  aria-label={`Remove ${a.filename}`}
                  style={{
                    position: 'absolute',
                    top: -6,
                    right: -6,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    border: '1px solid var(--border)',
                    background: 'var(--panel)',
                    color: 'var(--text-dim)',
                    cursor: 'pointer',
                    padding: 0,
                    lineHeight: 1,
                    fontSize: 13,
                  }}
                >×</button>
              </span>
            ) : (
              <span
                key={a.id}
                title={a.path}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: '4px 8px',
                  border: '1px solid var(--border)',
                  borderRadius: 4,
                  fontSize: 11, fontFamily: '"Geist Mono", monospace',
                  color: 'var(--text-dim)',
                  background: 'var(--panel)',
                }}
              >
                <span style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)' }} />
                {a.filename}
                <button
                  type="button"
                  className="composer-attachment-remove"
                  onClick={() => onRemove(a.id)}
                  title="Remove"
                  aria-label={`Remove ${a.filename}`}
                  style={{
                    cursor: 'pointer', opacity: 0.5, marginLeft: 2,
                    background: 'none', border: 'none', padding: 0,
                    color: 'inherit', font: 'inherit', lineHeight: 1,
                  }}
                >×</button>
              </span>
            )
          ))}
        </div>
      )}
      {hasImageAttachment(attachments) && currentModel && !modelSupportsVision(currentModel) && (
        <div style={{
          fontSize: 11,
          fontFamily: '"Geist Mono", monospace',
          color: 'var(--text-faint)',
          marginBottom: 6,
        }}>
          {currentModel.name} is text-only - the image won't be sent as vision input. Switch to a vision-capable model to have it described.
        </div>
      )}
      {(uploadError || uploading) && (
        <div style={{ fontSize: 11, color: uploadError ? 'var(--danger-muted)' : 'var(--text-faint)', marginBottom: 6 }}>
          {uploadError ?? 'Uploading...'}
        </div>
      )}
    </>
  );
}
