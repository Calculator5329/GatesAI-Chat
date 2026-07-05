// Bootstraps the visible app shell and lazy menu/chat composition.
// Called by main.tsx; depends on RootStore context, MobX observers, and shared CSS vars.
// Invariant: the RootStore owns state while App only chooses the current surface.
import { Suspense, lazy, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { observer } from 'mobx-react-lite';
import { buildTheme, themeToCssVars } from '../core/theme';
import type { ThemeColorScheme } from '../core/types';
import { useChatStore, useRootStore, useRouterStore, useUiStore } from '../stores/context';
import { EditorialSidebar } from '../components/editorial/EditorialSidebar';
import { EditorialChat } from '../components/editorial/EditorialChat';
import { CommandPalette } from '../components/palette/CommandPalette';
import { runtimeMode } from '../core/runtime';
import { primeClientPlatform } from '../core/clientPlatform';
import { useKeyboardShortcuts } from './useKeyboardShortcuts';

const GatesMenu = lazy(() => import('../components/menu/GatesMenu').then(m => ({ default: m.GatesMenu })));
const SYSTEM_LIGHT_QUERY = '(prefers-color-scheme: light)';

function systemPrefersLight(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(SYSTEM_LIGHT_QUERY).matches;
}

const stageStyle: CSSProperties = {
  height: '100dvh', width: '100vw',
  display: 'flex',
  background: 'var(--stage-bg)',
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
  const [systemLight, setSystemLight] = useState(systemPrefersLight);
  const effectiveTheme: ThemeColorScheme = ui.theme === 'light' || (ui.theme === 'system' && systemLight)
    ? 'light'
    : 'dark';
  const theme = useMemo(() => buildTheme('charcoal', 'emerald', effectiveTheme), [effectiveTheme]);
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

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
  }, [effectiveTheme]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const media = window.matchMedia(SYSTEM_LIGHT_QUERY);
    setSystemLight(media.matches);
    if (ui.theme !== 'system') return undefined;
    const handleChange = (event: MediaQueryListEvent) => setSystemLight(event.matches);
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, [ui.theme]);

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
