// Coordinates the left menu surface and section metadata used by the app shell.
// Called by App and sidebar navigation; depends on section keys, lazy components, and support flags.
// Invariant: every routed section key maps to exactly one component.
import { Suspense } from 'react';
import { observer } from 'mobx-react-lite';
import { useRouterStore } from '../../stores/context';
import { MENU_SECTIONS } from './menuSectionMeta';
import { tokens } from '../../core/styleTokens';

export const GatesMenu = observer(function GatesMenu() {
  const router = useRouterStore();
  const meta = MENU_SECTIONS.find(s => s.key === router.menuSection);
  const ActiveSection = meta?.component ?? MENU_SECTIONS[0].component;

  return (
    <div className="gates-menu" style={{
      display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0,
      background: 'var(--bg)', color: 'var(--text)',
      fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
      animation: `fadeIn ${tokens.motion.fade}`,
    }}>
      <div className="gates-menu__tabs" style={{
        display: 'flex', alignItems: 'flex-end', gap: 2,
        padding: '22px 56px 0',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto',
      }}>
        {MENU_SECTIONS.map(s => {
          const active = router.menuSection === s.key;
          const onSelect = () => router.goMenu(s.key);
          return (
            <button
              type="button"
              key={s.key}
              className="gates-menu__tab"
              data-active={active || undefined}
              onClick={onSelect}
              style={{
                padding: '11px 18px 12px',
                fontSize: 13,
                fontFamily: 'inherit',
                background: 'transparent',
                border: 0,
                color: active ? 'var(--text)' : 'var(--text-dim)',
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                userSelect: 'none',
              }}
            >
              <span>{s.label}</span>
            </button>
          );
        })}
      </div>
      <div className="gates-menu__body" style={{ flex: 1, overflowY: 'auto', padding: '32px 56px 60px' }}>
        <div className="gates-menu__inner" style={{ maxWidth: 720, margin: '0 auto' }}>
          <Suspense fallback={null}>
            <ActiveSection />
          </Suspense>
        </div>
      </div>
    </div>
  );
});
