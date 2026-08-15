// The foot of the sidebar is the only always-visible slot in the app. It used
// to hold BridgeStatusPill, which narrated "workspace ready" at the user
// permanently. It now holds the way into Settings, and keeps bridge state as
// the dot on the right — the honest part of the old pill, without the prose.
// Clicking the dot still force-polls the bridge; clicking the row opens Settings.
import { observer } from 'mobx-react-lite';
import { useEditorial, useRouterStore } from '../../stores/context';
import { isWebLite } from '../../core/runtime';
import { Icons } from '../ui/icons';

export const SidebarSettingsButton = observer(function SidebarSettingsButton() {
  const { bridge } = useEditorial();
  const router = useRouterStore();
  const webLite = isWebLite();

  let dotColor = 'var(--text-faint)';
  let dotTitle = 'Polling gatesai-bridge…';
  if (webLite) {
    dotColor = 'var(--status-blue)';
    dotTitle = 'Web Lite. Desktop workspace tools and local runtimes are unavailable in the browser.';
  } else if (bridge.state === 'online') {
    dotColor = 'var(--success)';
    const root = bridge.workspaceRoot ? `\n${bridge.workspaceRoot}` : '';
    dotTitle = `Workspace ready. Bridge ${bridge.version ?? ''} online.${root}\n${bridge.allowlist.length} allowlisted commands.\nClick to re-poll.`;
  } else if (bridge.state === 'offline' || bridge.state === 'incompatible') {
    dotColor = 'var(--danger-muted)';
    dotTitle = bridge.state === 'incompatible'
      ? `${bridge.lastError ?? 'Bridge protocol mismatch'}\n\nClick to re-poll after updating.`
      : `${bridge.lastError ?? 'Bridge offline'}\n\nStart with: gatesai-bridge\n\nClick to re-poll.`;
  }

  return (
    <button
      type="button"
      className="sidebar-settings-button"
      onClick={() => router.goMenu()}
      title="Settings and menu"
    >
      <span className="sidebar-settings-button__icon"><Icons.Gear /></span>
      <span>Settings</span>
      {/* Web Lite is a permanent runtime mode, not a transient status, so it
          stays stated in words. Bridge polling on desktop is transient and
          rides on the dot alone. */}
      {webLite && <span className="sidebar-settings-button__mode">web lite</span>}
      <span
        className="sidebar-settings-button__dot"
        style={{ background: dotColor }}
        title={dotTitle}
        role={webLite ? 'status' : 'button'}
        aria-label={webLite ? 'Web Lite' : 'Bridge status. Click to re-poll.'}
        tabIndex={webLite ? undefined : 0}
        onClick={event => {
          event.stopPropagation();
          if (!webLite) void bridge.poll();
        }}
        onKeyDown={event => {
          if (webLite || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          event.stopPropagation();
          void bridge.poll();
        }}
      />
    </button>
  );
});
