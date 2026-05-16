import { useEffect, useRef, useState, type CSSProperties, type MouseEvent, type TouchEvent } from 'react';
import { observer } from 'mobx-react-lite';
import { Icons } from '../ui/icons';
import type { MenuSectionKey, Thread } from '../../core/types';
import { useChatStore, useRouterStore } from '../../stores/context';
import { BridgeStatusPill } from './BridgeStatusPill';
import { ThreadTitle } from './ThreadTitle';

const UNDO_TIMEOUT_MS = 8000;
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
    width: 240, flexShrink: 0,
    background: 'transparent',
    borderRight: '1px solid var(--border)',
    display: 'flex', flexDirection: 'column',
    fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
  },
  head: { padding: '24px 20px 16px', cursor: 'pointer' },
  newBtn: {
    margin: '4px 16px 16px', padding: '8px 10px',
    fontSize: 12, color: 'var(--text-dim)',
    border: '1px solid var(--border)', borderRadius: 2,
    cursor: 'pointer',
    display: 'flex', alignItems: 'center', gap: 8,
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
  }),
  preview: {
    fontSize: 11, color: 'var(--text-faint)', marginTop: 2, fontStyle: 'italic',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  },
  // `scrollbarGutter: stable` reserves the scrollbar's space whether or not
  // the bar is currently rendered, so thread titles don't reflow (and the
  // history doesn't visibly jiggle) the moment the list grows past the
  // viewport and a real scrollbar appears.
  list: { flex: 1, overflowY: 'auto', paddingBottom: 16, scrollbarGutter: 'stable' as const },
  xBtn: {
    flex: 'none',
    width: 32, height: 32, minWidth: 32, minHeight: 32, padding: 0,
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
  search: {
    margin: '0 16px 10px',
    height: 30,
    padding: '0 9px',
    border: '1px solid var(--border)',
    borderRadius: 7,
    background: 'var(--panel)',
    color: 'var(--text)',
    font: '12px "Geist", ui-sans-serif, system-ui, sans-serif',
    outline: 'none',
  },
  rowActions: {
    flex: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    minWidth: 68,
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
  const onMenu = router.isMenu;
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const visible = normalizedQuery
    ? chat.visibleThreads.filter(t =>
        `${t.title} ${t.subtitle}`.toLowerCase().includes(normalizedQuery)
      )
    : chat.visibleThreads;
  const pinned = visible.filter(t => t.pinned);
  const unpinned = visible.filter(t => !t.pinned);
  const rest = normalizedQuery ? unpinned : unpinned.slice(0, 20);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; title: string } | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mobileShell, setMobileShell] = useState(false);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const mobileMenuTitle = MENU_LABELS[router.menuSection] ?? 'Menu';
  const mobileTitle = onMenu
    ? mobileMenuTitle
    : (chat.activeThread?.title || 'New conversation');

  useEffect(() => {
    const query = window.matchMedia('(max-width: 640px), (max-width: 960px) and (max-height: 480px)');
    const update = () => {
      setMobileShell(query.matches);
      if (!query.matches) setMobileOpen(false);
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [undo]);

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

  const onDelete = (t: Thread, e: MouseEvent): void => {
    e.stopPropagation();
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

  const renderItem = (t: Thread) => {
    const active = !onMenu && t.id === chat.activeThreadId;
    const streaming = chat.isThreadStreaming(t.id);
    const showActions = (hoveredId === t.id || active) && !streaming;
    return (
      <div
        key={t.id}
        className="editorial-sidebar__item"
        style={(S.item as (a: boolean) => CSSProperties)(active)}
        role="button"
        tabIndex={0}
        onClick={() => {
          chat.selectThread(t.id);
          router.goThread(t.id);
          setMobileOpen(false);
        }}
        onKeyDown={e => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          chat.selectThread(t.id);
          router.goThread(t.id);
          setMobileOpen(false);
        }}
        onFocus={() => setHoveredId(t.id)}
        onBlur={e => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setHoveredId(prev => (prev === t.id ? null : prev));
        }}
        onMouseEnter={() => setHoveredId(t.id)}
        onMouseLeave={() => setHoveredId(prev => (prev === t.id ? null : prev))}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ ...(S.title as (a: boolean) => CSSProperties)(active), flex: 1, minWidth: 0 }}>
            <ThreadTitle title={t.title} naming={t.naming === true} />
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
          {/* The X slot is always rendered to keep the title's flex slot
              stable. Hover toggles visibility, not layout — otherwise
              hovering a row would re-flow the title text. */}
          {!streaming && (
            <div
              className="editorial-sidebar__row-actions"
              style={{
                ...(S.rowActions as CSSProperties),
                visibility: showActions || t.pinned ? 'visible' : 'hidden',
                pointerEvents: showActions || t.pinned ? 'auto' : 'none',
              }}
              onClick={e => e.stopPropagation()}
            >
              <button
                type="button"
                className="editorial-sidebar__pin-button"
                onClick={() => chat.toggleThreadPinned(t.id)}
                aria-label={t.pinned ? `Unpin "${t.title}"` : `Pin "${t.title}"`}
                tabIndex={showActions || t.pinned ? 0 : -1}
                style={{ ...(S.xBtn as CSSProperties), color: t.pinned ? 'var(--accent)' : 'var(--text-faint)', opacity: t.pinned ? 1 : 0.72 }}
              >
                <Icons.Pin />
              </button>
              <button
                type="button"
                className="editorial-sidebar__delete-button"
                onClick={e => onDelete(t, e)}
                aria-label={`Delete "${t.title}"`}
                tabIndex={showActions ? 0 : -1}
                style={S.xBtn as CSSProperties}
              >
                <Icons.Close />
              </button>
            </div>
          )}
        </div>
        <div className="editorial-sidebar__preview" style={S.preview as CSSProperties}>{t.subtitle}</div>
      </div>
    );
  };

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
            onClick={() => void navigator.clipboard?.writeText(window.location.href)}
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
        style={S.head as CSSProperties}
        onClick={() => {
          if (mobileShell) {
            setMobileOpen(open => !open);
            return;
          }
          if (onMenu) router.goThread(chat.activeThreadId);
          else router.goMenu();
        }}
        title={mobileShell ? (mobileOpen ? 'Collapse sidebar' : 'Expand sidebar') : (onMenu ? 'Back to chat' : 'Open menu')}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <div className="editorial-sidebar__brand-text" style={{ fontFamily: '"Source Serif 4", Georgia, serif', fontSize: 22, fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.02em' }}>GatesAI</div>
          <div style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--accent)', alignSelf: 'center', marginBottom: 2 }} />
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
      <div
        className="editorial-sidebar__new"
        style={S.newBtn as CSSProperties}
        onClick={() => {
          router.goThread(chat.createThread());
          setMobileOpen(false);
        }}
        role="button"
      >
        <Icons.Plus />
        <span className="editorial-sidebar__new-label">Begin a new conversation</span>
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
      <input
        type="search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Search threads"
        aria-label="Search threads"
        style={S.search as CSSProperties}
      />
      <div className="editorial-sidebar__list" style={S.list as CSSProperties}>
        {pinned.length > 0 && <div className="editorial-sidebar__group" style={S.group as CSSProperties}>Pinned</div>}
        {pinned.map(renderItem)}
        <div className="editorial-sidebar__group" style={S.group as CSSProperties}>{normalizedQuery ? 'Matches' : 'Earlier'}</div>
        {rest.map(renderItem)}
        {visible.length === 0 && (
          <div style={{ padding: '12px 20px', color: 'var(--text-faint)', fontSize: 12, fontStyle: 'italic' }}>
            No conversations found.
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
