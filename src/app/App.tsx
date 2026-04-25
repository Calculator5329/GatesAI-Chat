import { useEffect, useMemo, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { buildTheme, themeToCssVars } from '../core/theme';
import { useChatStore, useRouterStore, useUiStore } from '../stores/context';
import { EditorialSidebar } from '../components/editorial/EditorialSidebar';
import { EditorialChat } from '../components/editorial/EditorialChat';
import { GatesMenu } from '../components/menu/GatesMenu';

const stageStyle: CSSProperties = {
  height: '100vh', width: '100vw',
  display: 'flex',
  background:
    'radial-gradient(ellipse at 20% 0%, rgba(91,140,255,0.06), transparent 60%), ' +
    'radial-gradient(ellipse at 80% 100%, rgba(120,110,150,0.04), transparent 60%), ' +
    '#050608',
};

const rootStyle: CSSProperties = {
  width: '100%', height: '100%',
  display: 'flex',
  minHeight: 0,
  background: 'var(--bg)',
  color: 'var(--text)',
  position: 'relative',
  overflow: 'hidden',
};

export const App = observer(function App() {
  const ui = useUiStore();
  const chat = useChatStore();
  const router = useRouterStore();
  const theme = useMemo(() => buildTheme(ui.bgKey, ui.accentKey), [ui.bgKey, ui.accentKey]);
  const appearanceClassName = [
    `markdown-${ui.markdownStyle}`,
    `markdown-density-${ui.markdownDensity}`,
    `code-${ui.codeStyle}`,
    `code-size-${ui.codeSize}`,
  ].join(' ');

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && router.isMenu) {
        router.goThread(chat.activeThreadId);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [router, chat]);

  useEffect(() => {
    return () => chat.stopStreaming();
  }, [chat]);

  return (
    <div style={stageStyle}>
      <div className={appearanceClassName} style={{ ...themeToCssVars(theme), ...rootStyle, fontFamily: theme.fontUi }}>
        <EditorialSidebar headerKey={ui.headerKey} />
        {router.isMenu
          ? <GatesMenu />
          : <EditorialChat sendKey={ui.sendKey} threadHeaderKey={ui.threadHeaderKey} />
        }
      </div>
    </div>
  );
});
