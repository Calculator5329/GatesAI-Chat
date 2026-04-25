import type { CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { Icons } from '../ui/icons';
import type { Thread, HeaderKey } from '../../core/types';
import { useChatStore, useRouterStore } from '../../stores/context';
import { EDITORIAL_HEADERS } from './headers';
import { BridgeStatusPill } from './BridgeStatusPill';
import { ThreadTitle } from './ThreadTitle';

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
  list: { flex: 1, overflowY: 'auto', paddingBottom: 16 },
};

interface SidebarProps {
  headerKey: HeaderKey;
}

export const EditorialSidebar = observer(function EditorialSidebar({ headerKey }: SidebarProps) {
  const chat = useChatStore();
  const router = useRouterStore();
  const onMenu = router.isMenu;
  const header = EDITORIAL_HEADERS[headerKey];
  const pinned = chat.threads.filter(t => t.pinned);
  const rest = chat.threads.filter(t => !t.pinned).slice(0, 20);

  const renderItem = (t: Thread) => {
    const active = !onMenu && t.id === chat.activeThreadId;
    const streaming = chat.isThreadStreaming(t.id);
    return (
      <div
        key={t.id}
        style={(S.item as (a: boolean) => CSSProperties)(active)}
        onClick={() => router.goThread(t.id)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={(S.title as (a: boolean) => CSSProperties)(active)}>
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
        </div>
        <div style={S.preview as CSSProperties}>{t.subtitle}</div>
      </div>
    );
  };

  return (
    <aside style={S.root as CSSProperties}>
      <div
        style={S.head as CSSProperties}
        onClick={() => onMenu ? router.goThread(chat.activeThreadId) : router.goMenu()}
        title={onMenu ? 'Back to chat' : 'Open menu'}
      >
        {header.render()}
      </div>
      <div
        style={S.newBtn as CSSProperties}
        onClick={() => router.goThread(chat.createThread())}
        role="button"
      >
        <Icons.Plus />
        <span>Begin a new conversation</span>
      </div>
      <div style={S.list as CSSProperties}>
        {pinned.length > 0 && <div style={S.group as CSSProperties}>Pinned</div>}
        {pinned.map(renderItem)}
        <div style={S.group as CSSProperties}>Earlier</div>
        {rest.map(renderItem)}
      </div>
      <BridgeStatusPill />
    </aside>
  );
});
