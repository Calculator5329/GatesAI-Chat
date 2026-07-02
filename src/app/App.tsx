// Bootstraps the visible app shell and lazy menu/chat composition.
// Called by main.tsx; depends on RootStore context, MobX observers, and shared CSS vars.
// Invariant: the RootStore owns state while App only chooses the current surface.
import { Suspense, lazy, useEffect, useMemo, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { buildTheme, themeToCssVars } from '../core/theme';
import { useChatStore, useRootStore, useRouterStore, useUiStore } from '../stores/context';
import { EditorialSidebar } from '../components/editorial/EditorialSidebar';
import { EditorialChat } from '../components/editorial/EditorialChat';
import { CommandPalette } from '../components/palette/CommandPalette';
import { runtimeMode } from '../core/runtime';
import { primeClientPlatform } from '../core/clientPlatform';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const GatesMenu = lazy(() => import('../components/menu/GatesMenu').then(m => ({ default: m.GatesMenu })));

const stageStyle: CSSProperties = {
  height: '100dvh', width: '100vw',
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
  const root = useRootStore();
  const ui = useUiStore();
  const chat = useChatStore();
  const router = useRouterStore();
  const theme = useMemo(() => buildTheme('charcoal', 'emerald'), []);
  const appearanceClassName = [
    `runtime-${runtimeMode()}`,
    `markdown-${ui.markdownStyle}`,
    `markdown-density-${ui.markdownDensity}`,
    `code-${ui.codeStyle}`,
    `code-size-${ui.codeSize}`,
    ui.animationsEnabled ? '' : 'no-animations',
  ].filter(Boolean).join(' ');
  const appearanceVars: CSSProperties = {
    ['--md-body-font-size' as string]: `${ui.bodyFontSizePx}px`,
    ['--reading-width' as string]: `${ui.readingWidthPx}px`,
  };

  useKeyboardShortcuts(root);

  useEffect(() => {
    return () => chat.stopStreaming();
  }, [chat]);

  // Resolve the client's CPU architecture once so Web Lite download
  // recommendations (x64 vs ARM) are accurate by the first turn. Fire-and-forget.
  useEffect(() => {
    void primeClientPlatform();
  }, []);

  return (
    <div style={stageStyle}>
      <div className={appearanceClassName} style={{ ...themeToCssVars(theme), ...appearanceVars, ...rootStyle, fontFamily: theme.fontUi }}>
        <EditorialSidebar />
        {router.isMenu
          ? (
            <Suspense fallback={null}>
              <GatesMenu />
            </Suspense>
          )
          : <EditorialChat />
        }
        {ui.paletteOpen && <CommandPalette />}
      </div>
    </div>
  );
});
