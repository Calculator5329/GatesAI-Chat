// Command palette for app actions and thread search.
// Rendered by App only while UiStore.paletteOpen is true; no closed-state DOM
// remains, so it cannot intercept sidebar clicks.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { observer } from 'mobx-react-lite';
import { useArtifactStore, useChatStore, useDockStore, useRouterStore, useUiStore } from '../../stores/context';
import { Icons } from '../ui/icons';
import { rankPaletteItems } from './ranking';
import type { MenuSectionKey, Thread } from '../../core/types';
import { tokens } from '../../core/styleTokens';

type PaletteItemKind = 'action' | 'thread';

interface PaletteItem {
  id: string;
  kind: PaletteItemKind;
  label: string;
  subtitle?: string;
  keywords?: string[];
  run: () => void;
}

const BACKDROP_STYLE: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 1200,
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'center',
  padding: '12vh 18px 18px',
  background: 'var(--overlay-scrim)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  boxSizing: 'border-box',
};

const PANEL_STYLE: CSSProperties = {
  width: 'min(640px, 100%)',
  maxHeight: 'min(680px, 76vh)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'color-mix(in srgb, var(--panel) 94%, var(--stage-bg-static) 6%)',
  color: 'var(--text)',
  boxShadow: '0 28px 90px rgba(0,0,0,0.58)',
  fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
  animation: `fadeIn ${tokens.motion.fade}`,
};

const SEARCH_WRAP_STYLE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '16px 18px',
  borderBottom: '1px solid var(--border)',
  background: 'color-mix(in srgb, var(--panel-2) 58%, transparent)',
};

const INPUT_STYLE: CSSProperties = {
  flex: 1,
  minWidth: 0,
  border: 0,
  outline: 0,
  background: 'transparent',
  color: 'var(--text)',
  font: '15px "Geist", ui-sans-serif, system-ui, sans-serif',
  letterSpacing: 0,
};

const LIST_STYLE: CSSProperties = {
  overflowY: 'auto',
  padding: '8px',
};

const EMPTY_STYLE: CSSProperties = {
  padding: '34px 20px',
  color: 'var(--text-faint)',
  textAlign: 'center',
  font: 'italic 14px "Source Serif 4", Georgia, serif',
};

const TYPE_STYLE: CSSProperties = {
  flex: 'none',
  color: 'var(--text-faint)',
  fontFamily: '"Geist Mono", ui-monospace, monospace',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

export const CommandPalette = observer(function CommandPalette() {
  const ui = useUiStore();
  const chat = useChatStore();
  const router = useRouterStore();
  const dock = useDockStore();
  const artifactStore = useArtifactStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  // Read observables outside the memo so the observer keeps tracking them
  // across re-renders (a memoized callback skips the read on cached hits).
  const dockEntryVisible = dock.available && !ui.mobileShell;
  const registeredArtifacts = artifactStore.artifacts;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const items = useMemo<PaletteItem[]>(() => {
    return [
      actionItem('new-conversation', 'New conversation', 'Start a blank thread', ['new chat thread'], () => {
        const id = chat.createThread();
        router.goThread(id);
      }),
      menuItem('settings', 'Open settings', 'Settings', ['preferences menu'], router.goMenu),
      menuItem('models', 'Open models', 'Models', ['model api key openrouter'], router.goMenu),
      menuItem('workspace', 'Open workspace', 'Workspace', ['files source bridge'], router.goMenu),
      menuItem('gallery', 'Open gallery', 'Gallery', ['images artifacts'], router.goMenu),
      actionItem('toggle-fullscreen', 'Toggle fullscreen', 'F11 — use the whole screen', ['fullscreen full screen f11 window maximize'], () => {
        ui.toggleFullscreen();
      }),
      // Dock entry points are desktop-only: the v1 panels read workspace
      // files through the bridge, which Web Lite doesn't have.
      ...(dockEntryVisible
        ? [
          actionItem('open-file-in-dock', 'Open file in dock…', 'View a workspace file in the right dock', ['dock panel file viewer open workspace'], () => {
            const path = window.prompt('Workspace path to open in the dock', '/workspace/');
            if (path && path.trim() && path.trim() !== '/workspace/') dock.openPath(path);
          }),
          actionItem('browse-files-in-dock', 'Browse workspace in dock', 'Explore jailed workspace files', ['dock panel file explorer folders'], () => {
            dock.openPanel('file-explorer', { path: '/workspace' });
          }),
          actionItem('open-task-center', 'Open task center', 'Monitor background work in the right dock', ['dock panel tasks agents images progress'], () => {
            dock.openPanel('task-center');
          }),
          ...registeredArtifacts.map(artifact => actionItem(
            `open-artifact-${artifact.id}`,
            `Open artifact: ${artifact.title}`,
            `HTML artifact · revision ${artifact.revision}`,
            ['dock panel html artifact', artifact.id],
            () => { dock.openArtifact(artifact.id); },
          )),
        ]
        : []),
      ...chat.visibleThreads.map(threadItem(chat, router)),
    ];
  }, [chat, router, ui, dock, dockEntryVisible, registeredArtifacts]);

  const ranked = useMemo(() => rankPaletteItems(items, query).map(entry => entry.item), [items, query]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    setSelectedIndex(index => Math.min(index, Math.max(0, ranked.length - 1)));
  }, [ranked.length]);

  const execute = (item: PaletteItem | undefined): void => {
    if (!item) return;
    ui.closePalette();
    item.run();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      event.stopPropagation();
      setSelectedIndex(index => Math.min(index + 1, Math.max(0, ranked.length - 1)));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      event.stopPropagation();
      setSelectedIndex(index => Math.max(0, index - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      execute(ranked[selectedIndex]);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      ui.closePalette();
    }
  };

  return (
    <div
      className="command-palette__backdrop"
      data-testid="command-palette-backdrop"
      onClick={event => {
        if (event.target === event.currentTarget) ui.closePalette();
      }}
      style={BACKDROP_STYLE}
    >
      <div
        className="command-palette"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={event => event.stopPropagation()}
        onKeyDown={onKeyDown}
        style={PANEL_STYLE}
      >
        <div style={SEARCH_WRAP_STYLE}>
          <span aria-hidden="true" style={{ display: 'flex', color: 'var(--text-faint)' }}>
            <Icons.Search />
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={event => setQuery(event.currentTarget.value)}
            aria-label="Search commands and threads"
            placeholder="Search threads or actions..."
            spellCheck={false}
            style={INPUT_STYLE}
          />
        </div>
        <div className="command-palette__list" role="listbox" aria-label="Command results" style={LIST_STYLE}>
          {ranked.length === 0 && <div style={EMPTY_STYLE}>No matching command or thread.</div>}
          {ranked.map((item, index) => (
            <PaletteRow
              key={item.id}
              item={item}
              selected={index === selectedIndex}
              onHover={() => setSelectedIndex(index)}
              onRun={() => execute(item)}
            />
          ))}
        </div>
      </div>
    </div>
  );
});

function PaletteRow({
  item,
  selected,
  onHover,
  onRun,
}: {
  item: PaletteItem;
  selected: boolean;
  onHover: () => void;
  onRun: () => void;
}) {
  const rowStyle: CSSProperties = {
    width: '100%',
    display: 'grid',
    gridTemplateColumns: '20px minmax(0, 1fr) auto',
    alignItems: 'center',
    gap: 10,
    padding: '10px 11px',
    border: '1px solid transparent',
    borderRadius: 6,
    background: selected ? 'var(--panel-2)' : 'transparent',
    color: selected ? 'var(--text)' : 'var(--text-dim)',
    cursor: 'pointer',
    font: 'inherit',
    textAlign: 'left',
    boxSizing: 'border-box',
  };
  return (
    <button
      type="button"
      role="option"
      className="palette-row"
      aria-selected={selected}
      data-selected={selected || undefined}
      data-palette-kind={item.kind}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onRun}
      style={rowStyle}
    >
      <span aria-hidden="true" style={{ display: 'flex', color: item.kind === 'action' ? 'var(--accent)' : 'var(--text-faint)' }}>
        {item.kind === 'action' ? <Icons.Wrench /> : <Icons.FileText />}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{
          display: 'block',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          fontSize: 13,
          lineHeight: 1.3,
          letterSpacing: 0,
        }}>
          {item.label}
        </span>
        {item.subtitle && (
          <span style={{
            display: 'block',
            marginTop: 2,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: 'var(--text-faint)',
            font: 'italic 12px "Source Serif 4", Georgia, serif',
          }}>
            {item.subtitle}
          </span>
        )}
      </span>
      <span style={TYPE_STYLE}>{item.kind}</span>
    </button>
  );
}

function actionItem(id: string, label: string, subtitle: string, keywords: string[], run: () => void): PaletteItem {
  return { id: `action:${id}`, kind: 'action', label, subtitle, keywords, run };
}

function menuItem(section: MenuSectionKey, label: string, subtitle: string, keywords: string[], goMenu: (section: MenuSectionKey) => void): PaletteItem {
  return actionItem(section, label, subtitle, keywords, () => goMenu(section));
}

function threadItem(chat: { selectThread: (id: string) => boolean }, router: { goThread: (id: string) => void }) {
  return (thread: Thread): PaletteItem => ({
    id: `thread:${thread.id}`,
    kind: 'thread',
    label: thread.title.trim() || 'New conversation',
    subtitle: thread.subtitle || 'Thread',
    keywords: [thread.id],
    run: () => {
      chat.selectThread(thread.id);
      router.goThread(thread.id);
    },
  });
}
