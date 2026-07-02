// The thread-list navigation sidebar: pin, soft-delete + undo, and menu
// section navigation. Rendered by the app shell; reads RootStore via hooks.
// Invariant: persisted chat state stays in stores; this surface is presentation only.
import { useEffect, useRef, useState, type CSSProperties, type TouchEvent } from 'react';
import { observer } from 'mobx-react-lite';
import { Icons } from '../ui/icons';
import type { MenuSectionKey, Thread } from '../../core/types';
import { useChatStore, useRouterStore, useUiStore } from '../../stores/context';
import { BridgeStatusPill } from './BridgeStatusPill';
import { ThreadTitle } from './ThreadTitle';

const UNDO_TIMEOUT_MS = 8000;
// First-run menu coach: show it briefly, then bow out on its own so it never nags.
const MENU_HINT_TIMEOUT_MS = 9000;
const HISTORY_ROW_LIMIT = 20;
const MENU_LABELS: Record<MenuSectionKey, string> = {
  agent: 'Agent',
  models: 'Models',
  local: 'Local',
  workspace: 'Workspace',
  gallery: 'Gallery',
  settings: 'Settings',
};

const S: Record<string, CSSProperties | ((arg: boolean) => CSSProperties)> = {
  root: {
    width: 270, flexShrink: 0,
    background: 'transparent',
    borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column',
    fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
  },
  head: { padding: '24px 20px 16px', cursor: 'pointer' },
  newBtn: {
    padding: '8px 10px',
    fontSize: 12, color: 'var(--text-dim)',
    border: '1px solid var(--border)', borderRadius: 2,
    background: 'transparent',
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 8,
    width: '100%',
  },
  group: { padding: '8px 20px 4px', fontSize: 10, color: 'var(--text-faint)', letterSpacing: '0.12em', textTransform: 'uppercase' },
  item: (active: boolean) => ({
    padding: '8px 20px',
    cursor: 'pointer',
    borderLeft: active ? '2px solid var(--accent)' : '2px solid transparent',
    background: active ? 'rgba(232,169,72,0.04)' : 'transparent',
  }),
  title: (active: boolean) => ({
    fontSize: 13, color: active ? 'var(--text)' : 'var(--text-dim)',
    fontWeight: 400, letterSpacing: '-0.005em',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  }),
  // `scrollbarGutter: stable` reserves the scrollbar's space whether or not
  // the bar is currently rendered, so thread titles don't reflow (and the
  // history doesn't visibly jiggle) the moment the list grows past the
  // viewport and a real scrollbar appears.
  list: { flex: 1, overflowY: 'auto', paddingBottom: 16, scrollbarGutter: 'stable' as const },
  xBtn: {
    flex: 'none',
    width: 24, height: 24, minWidth: 24, minHeight: 24, padding: 0,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    color: 'var(--text-faint)',
    cursor: 'pointer',
    borderRadius: 5,
    opacity: 0.78,
    overflow: 'visible',
  },
  undo: {
    margin: '8px 16px 4px',
    padding: '8px 10px',
    fontSize: 11.5,
    color: 'var(--text-dim)',
    background: 'color-mix(in srgb, var(--bg) 92%, var(--text) 8%)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    display: 'flex', alignItems: 'center', gap: 8,
  },
  undoBtn: {
    background: 'transparent',
    border: 'none',
    color: 'var(--accent)',
    cursor: 'pointer',
    fontSize: 11.5,
    fontWeight: 500,
    padding: '2px 4px',
  },
  rowActions: {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 2,
    minWidth: 50,
    overflow: 'visible',
  },
  inlineInput: {
    width: '100%',
    boxSizing: 'border-box',
    border: '1px solid var(--border)',
    borderRadius: 5,
    background: 'var(--panel)',
    color: 'var(--text)',
    font: '13px "Geist", ui-sans-serif, system-ui, sans-serif',
    padding: '3px 5px',
    outline: 'none',
  },
};

export const EditorialSidebar = observer(function EditorialSidebar() {
  const chat = useChatStore();
  const router = useRouterStore();
  const ui = useUiStore();
  const onMenu = router.isMenu;
  const pinned = chat.visibleThreads.filter(t => t.pinned);
  const rest = chat.visibleThreads.filter(t => !t.pinned).slice(0, HISTORY_ROW_LIMIT);

  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  // Single source of truth for the breakpoint lives in UiStore (matchMedia
  // on MOBILE_SHELL_QUERY), shared with src/styles/responsive.css.
  const mobileShell = ui.mobileShell;
  // First-run cue: surface the menu coachmark until the user opens the menu.
  // State + persistence live in UiStore (no direct storage here).
  const showMenuHint = !ui.menuHintSeen && !onMenu;
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const mobileMenuTitle = MENU_LABELS[router.menuSection] ?? 'Menu';
  const mobileTitle = onMenu
    ? mobileMenuTitle
    : (chat.activeThread?.title || 'New conversation');

  // Leaving the mobile shell (e.g. rotating / resizing) closes the drawer.
  useEffect(() => {
    if (!mobileShell) setMobileOpen(false);
  }, [mobileShell]);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  // Let the first-run menu coach linger just long enough to be noticed, then
  // dismiss itself. Clicking it (or opening the menu) marks it seen sooner.
  useEffect(() => {
    if (!showMenuHint) return;
    const timer = setTimeout(() => ui.markMenuHintSeen(), MENU_HINT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [showMenuHint, ui]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mobileOpen]);

  useEffect(() => {
    if (!mobileShell) return;
    setMobileOpen(false);
  }, [chat.activeThreadId, router.isMenu, mobileShell]);

  const onDelete = (t: Thread): void => {
    chat.softDeleteThread(t.id);
    setUndo({ id: t.id, title: t.title });
  };
  const onUndo = (): void => {
    if (!undo) return;
    chat.restoreThread(undo.id);
    router.goThread(undo.id);
    setUndo(null);
    setMobileOpen(false);
  };

  const onMobileTouchStart = (e: TouchEvent<HTMLElement>): void => {
    if (!mobileShell) return;
    const touch = e.touches[0];
    touchStartRef.current = { x: touch.clientX, y: touch.clientY };
  };

  const onMobileTouchEnd = (e: TouchEvent<HTMLElement>): void => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    if (!mobileShell || !start) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    if (Math.abs(dy) > 48 || Math.abs(dx) < 44) return;
    if (!mobileOpen && start.x <= 28 && dx > 0) setMobileOpen(true);
    if (mobileOpen && dx < 0) setMobileOpen(false);
  };

  const renderItem = (t: Thread) => (
    <SidebarThreadRow
      key={t.id}
      thread={t}
      onMenu={onMenu}
      onDelete={onDelete}
      onCloseMobile={() => setMobileOpen(false)}
    />
  );

  return (
    <>
    {mobileShell && (
      <header className="editorial-mobile-topbar">
        <button
          type="button"
          className={`editorial-mobile-topbar__button${onMenu ? ' editorial-mobile-topbar__back' : ''}`}
          aria-label={onMenu ? 'Back to chat' : 'Open sidebar'}
          onClick={() => {
            if (onMenu) {
              router.goThread(chat.activeThreadId);
              setMobileOpen(false);
              return;
            }
            setMobileOpen(true);
          }}
        >
          {onMenu ? <Icons.Back /> : (
            <>
              <span />
              <span />
              <span />
            </>
          )}
        </button>
        <button
          type="button"
          className="editorial-mobile-topbar__title"
          onClick={() => {
            if (!onMenu) setMobileOpen(true);
          }}
          title={mobileTitle}
        >
          {mobileTitle}
        </button>
        <div className="editorial-mobile-topbar__actions">
          <button
            type="button"
            className="editorial-mobile-topbar__new"
            aria-label="New conversation"
            title="New conversation"
            onClick={() => {
              router.goThread(chat.createThread());
              setMobileOpen(false);
            }}
          >
            <Icons.Edit />
          </button>
          <button
            type="button"
            className="editorial-mobile-topbar__share"
            aria-label="Copy link"
            title="Copy link"
            onClick={() => void navigator.clipboard?.writeText(router.hrefForThread(chat.activeThreadId))}
          >
            <Icons.Share />
          </button>
          <button
            type="button"
            className="editorial-mobile-topbar__more"
            aria-label="Open sidebar"
            title="Open sidebar"
            onClick={() => setMobileOpen(true)}
          >
            <Icons.More />
          </button>
        </div>
      </header>
    )}
    {mobileShell && mobileOpen && (
      <button
        type="button"
        className="editorial-sidebar__scrim"
        aria-label="Close sidebar"
        onClick={() => setMobileOpen(false)}
      />
    )}
    <aside
      className="editorial-sidebar"
      data-mobile-open={mobileOpen || undefined}
      style={S.root as CSSProperties}
      onTouchStart={onMobileTouchStart}
      onTouchEnd={onMobileTouchEnd}
    >
      <div
        className="editorial-sidebar__brand"
        data-hint={showMenuHint && !mobileShell ? 'true' : undefined}
        style={S.head as CSSProperties}
        onClick={() => {
          if (mobileShell) {
            ui.markMenuHintSeen();
            setMobileOpen(open => !open);
            return;
          }
          if (onMenu) router.goThread(chat.activeThreadId);
          else {
            ui.markMenuHintSeen();
            router.goMenu();
          }
        }}
        title={mobileShell ? (mobileOpen ? 'Collapse sidebar' : 'Expand sidebar') : (onMenu ? 'Back to chat' : 'Open menu')}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <div className="editorial-sidebar__brand-text" style={{ fontFamily: '"Source Serif 4", Georgia, serif', fontSize: 22, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.02em' }}>GatesAI</div>
          <div className="editorial-sidebar__brand-dot" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', alignSelf: 'center', marginBottom: 2 }} />
        </div>
        {mobileShell && (
          <button
            type="button"
            className="editorial-sidebar__close"
            aria-label="Close sidebar"
            onClick={(e) => {
              e.stopPropagation();
              setMobileOpen(false);
            }}
          >
            <Icons.Close />
          </button>
        )}
      </div>
      {showMenuHint && !mobileShell && (
        <button
          type="button"
          className="editorial-sidebar__menu-coach"
          onClick={() => {
            ui.markMenuHintSeen();
            router.goMenu();
          }}
        >
          <span className="editorial-sidebar__menu-coach-dot" />
          Settings &amp; menu live here
        </button>
      )}
      <div className="editorial-sidebar__action-slot">
        <button
          type="button"
          className="editorial-sidebar__new"
          aria-label="Begin a new conversation"
          style={S.newBtn as CSSProperties}
          onClick={() => {
            router.goThread(chat.createThread());
            setMobileOpen(false);
          }}
        >
          <Icons.Plus />
          <span className="editorial-sidebar__new-label">Begin a new conversation</span>
        </button>
      </div>
      {mobileShell && (
        <div className="editorial-sidebar__mobile-actions">
          <button
            type="button"
            onClick={() => {
              router.goMenu();
              setMobileOpen(false);
            }}
          >
            Menu and settings
          </button>
        </div>
      )}
      <div className="editorial-sidebar__list" style={S.list as CSSProperties}>
        {pinned.length > 0 && <div className="editorial-sidebar__group" style={S.group as CSSProperties}>Pinned</div>}
        {pinned.map(renderItem)}
        <div className="editorial-sidebar__group" style={S.group as CSSProperties}>Earlier</div>
        {rest.map(renderItem)}
        {pinned.length === 0 && rest.length === 0 && (
          <div style={{ padding: '12px 20px', color: 'var(--text-faint)', fontSize: 12, fontStyle: 'italic' }}>
            No conversations yet.
          </div>
        )}
      </div>
      {undo && (
        <div style={S.undo as CSSProperties} role="status">
          <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            Deleted "{undo.title}"
          </span>
          <button type="button" onClick={onUndo} style={S.undoBtn as CSSProperties}>Undo</button>
        </div>
      )}
      <BridgeStatusPill />
    </aside>
    </>
  );
});

const SidebarThreadRow = observer(function SidebarThreadRow({
  thread,
  onMenu,
  onDelete,
  onCloseMobile,
}: {
  thread: Thread;
  onMenu: boolean;
  onDelete: (thread: Thread) => void;
  onCloseMobile: () => void;
}) {
  const chat = useChatStore();
  const router = useRouterStore();
  const [hovered, setHovered] = useState(false);
  const active = !onMenu && thread.id === chat.activeThreadId;
  const streaming = chat.isThreadStreaming(thread.id);
  const showActions = (hovered || active) && !streaming;

  const selectThread = (): void => {
    chat.selectThread(thread.id);
    router.goThread(thread.id);
    onCloseMobile();
  };

  return (
    <div
      className="editorial-sidebar__item"
      style={(S.item as (a: boolean) => CSSProperties)(active)}
      role="button"
      tabIndex={0}
      onClick={selectThread}
      onKeyDown={event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        selectThread();
      }}
      onFocus={() => setHovered(true)}
      onBlur={event => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setHovered(false);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ ...(S.title as (a: boolean) => CSSProperties)(active), flex: 1, minWidth: 0 }}>
          <ThreadTitle title={thread.title} naming={thread.naming === true} />
        </div>
        {streaming && (
          <span
            title="Receiving response"
            style={{
              width: 6, height: 6, borderRadius: '50%',
              background: 'var(--accent)',
              boxShadow: '0 0 6px var(--accent-glow)',
              animation: 'thinkingDot 1.1s ease-in-out infinite',
              flex: 'none',
            }}
          />
        )}
        {/* Keep the action slot mounted so hover/focus changes never reflow the title. */}
        {!streaming && (
          <div
            className="editorial-sidebar__row-actions"
            style={{
              ...(S.rowActions as CSSProperties),
              visibility: showActions || thread.pinned ? 'visible' : 'hidden',
              pointerEvents: showActions || thread.pinned ? 'auto' : 'none',
            }}
            onClick={event => event.stopPropagation()}
          >
            <button
              type="button"
              className="editorial-sidebar__pin-button"
              onClick={() => chat.toggleThreadPinned(thread.id)}
              aria-label={thread.pinned ? `Unpin "${thread.title}"` : `Pin "${thread.title}"`}
              tabIndex={showActions || thread.pinned ? 0 : -1}
              style={{ ...(S.xBtn as CSSProperties), color: thread.pinned ? 'var(--accent)' : 'var(--text-faint)', opacity: thread.pinned ? 1 : 0.72 }}
            >
              <Icons.Pin />
            </button>
            <button
              type="button"
              className="editorial-sidebar__delete-button"
              onClick={() => onDelete(thread)}
              aria-label={`Delete "${thread.title}"`}
              tabIndex={showActions ? 0 : -1}
              style={S.xBtn as CSSProperties}
            >
              <Icons.Trash />
            </button>
          </div>
        )}
      </div>
    </div>
  );
});
