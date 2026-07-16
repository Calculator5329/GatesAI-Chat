// Dedicated dock surface for a registry-backed HTML artifact. The registry id
// resolves to the canonical workspace path; rendering stays in the existing
// CSP/sandboxed HtmlArtifactPreview component.
import { observer } from 'mobx-react-lite';
import { htmlArtifactPath, isHtmlArtifactId } from '../../core/htmlArtifacts';
import { useArtifactStore } from '../../stores/context';
import { HtmlArtifactPreview } from '../editorial/HtmlArtifactPreview';
import type { DockPanelProps } from './panelRegistry';

export const HtmlArtifactPanel = observer(function HtmlArtifactPanel({ params }: DockPanelProps) {
  const artifacts = useArtifactStore();
  const id = params.id ?? '';
  if (!isHtmlArtifactId(id)) {
    return <div className="dock-panel__notice" role="alert">No valid HTML artifact selected.</div>;
  }
  const record = artifacts.findById(id);
  return (
    <div className="dock-html-artifact" data-testid="dock-html-artifact">
      <HtmlArtifactPreview path={htmlArtifactPath(id)} label={record?.title ?? id} />
    </div>
  );
});
