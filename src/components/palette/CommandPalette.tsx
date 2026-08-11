// Command palette for app actions and thread search.
// Rendered by App only while UiStore.paletteOpen is true; no closed-state DOM
// remains, so it cannot intercept sidebar clicks.
import { Fragment, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { observer } from 'mobx-react-lite';
import { useArtifactStore, useChatStore, useDockStore, useRouterStore, useUiPack, useUiStore } from '../../stores/context';
import { Icons } from '../ui/icons';
import { rankPaletteItems } from './ranking';
import type { MenuSectionKey, Thread } from '../../core/types';
import { tokens } from '../../core/styleTokens';
import { UI_PACKS, uiPackMeta, type UiPackKey } from '../../core/uiPacks';

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

const GROUP_HEADING_STYLE: CSSProperties = {
  padding: '10px 11px 4px',
  color: 'var(--text-faint)',
  fontFamily: '"Geist Mono", ui-monospace, monospace',
  fontSize: 10,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
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
  const pack = useUiPack();
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
      menuItem('models', 'Open models', 'Models', ['model api key openrouter local ollama'], router.goMenu),
      menuItem('agent', 'Open agent', 'Agent', ['instructions memory system prompt'], router.goMenu),
      actionItem('toggle-fullscreen', 'Toggle fullscreen', 'F11 — use the whole screen', ['fullscreen full screen f11 window maximize'], () => {
        ui.toggleFullscreen();
      }),
      // The before/after switcher, one keystroke away: comparing packs is the
      // point of having packs, and a settings round trip loses the comparison.
      actionItem(
        'cycle-ui-pack',
        `Switch interface pack — ${uiPackMeta(nextUiPack(ui.uiPack)).name}`,
        `Currently ${uiPackMeta(ui.uiPack).name}`,
        ['pack theme interface presentation aurora classic before after switch'],
        () => ui.setUiPack(nextUiPack(ui.uiPack)),
      ),
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
  const aurora = pack === 'aurora';
  // Aurora groups the ranked list without reordering it: the first row of each
  // kind gets a heading, so ranking still decides what comes first.
  const firstIndexOfKind = useMemo(() => {
    const first: Partial<Record<PaletteItemKind, number>> = {};
    ranked.forEach((item, index) => {
      if (first[item.kind] === undefined) first[item.kind] = index;
    });
    return first;
  }, [ranked]);
  const counts = useMemo(() => ({
    action: items.filter(item => item.kind === 'action').length,
    thread: items.filter(item => item.kind === 'thread').length,
  }), [items]);

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
          {ranked.length === 0 && (
            aurora
              ? <PaletteEmpty query={query} actionCount={counts.action} threadCount={counts.thread} />
              : <div style={EMPTY_STYLE}>No matching command or thread.</div>
          )}
          {ranked.map((item, index) => (
            <Fragment key={item.id}>
              {aurora && index === firstIndexOfKind[item.kind] && (
                <div style={GROUP_HEADING_STYLE}>{item.kind === 'action' ? 'Actions' : 'Conversations'}</div>
              )}
              <PaletteRow
                item={item}
                selected={index === selectedIndex}
                query={aurora ? query : ''}
                onHover={() => setSelectedIndex(index)}
                onRun={() => execute(item)}
              />
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
});

/**
 * Aurora's empty state: names what was searched instead of only reporting a
 * miss, so an empty result reads as "nothing here" rather than "search broken".
 */
function PaletteEmpty({ query, actionCount, threadCount }: { query: string; actionCount: number; threadCount: number }) {
  return (
    <div style={EMPTY_STYLE} data-testid="palette-empty">
      <div style={{ color: 'var(--text-dim)', fontStyle: 'normal', fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif', fontSize: 13 }}>
        Nothing matches “{query}”
      </div>
      <div style={{ marginTop: 6, fontSize: 12 }}>
        Searched {actionCount} action{actionCount === 1 ? '' : 's'} and {threadCount} conversation{threadCount === 1 ? '' : 's'}.
      </div>
    </div>
  );
}

function PaletteRow({
  item,
  selected,
  query,
  onHover,
  onRun,
}: {
  item: PaletteItem;
  selected: boolean;
  /** Non-empty only in Aurora, where the matched span is highlighted. */
  query: string;
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
          <Highlighted text={item.label} query={query} />
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

/**
 * Marks the matched span of a label. Plain substring matching on purpose: the
 * ranker is fuzzier than this, so a row can match without a visible highlight,
 * but a highlight is never shown where the text does not actually match.
 */
function Highlighted({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  if (!needle) return <>{text}</>;
  const at = text.toLowerCase().indexOf(needle);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark style={{ background: 'transparent', color: 'var(--accent)', fontWeight: 500 }}>
        {text.slice(at, at + needle.length)}
      </mark>
      {text.slice(at + needle.length)}
    </>
  );
}

/** Next pack in registry order, wrapping — the palette's before/after toggle. */
function nextUiPack(current: UiPackKey): UiPackKey {
  const index = UI_PACKS.findIndex(pack => pack.key === current);
  return UI_PACKS[(index + 1) % UI_PACKS.length].key;
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
