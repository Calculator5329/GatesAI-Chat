import { Suspense } from 'react';
import { observer } from 'mobx-react-lite';
import { useRouterStore } from '../../stores/context';
import { MENU_SECTIONS } from './menuSectionMeta';

const badgeStyle: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  background: 'var(--border)',
  color: 'var(--text-faint)',
  borderRadius: 3,
  padding: '1px 5px',
  marginLeft: 6,
  verticalAlign: 'middle',
};

export const GatesMenu = observer(function GatesMenu() {
  const router = useRouterStore();
  const meta = MENU_SECTIONS.find(s => s.key === router.menuSection);
  const fallback = MENU_SECTIONS.find(s => s.supported)!.component;
  const ActiveSection = (meta?.supported ? meta.component : null) ?? fallback;

  return (
    <div className="gates-menu" style={{
      display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0,
      background: 'var(--bg)', color: 'var(--text)',
      fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
      animation: 'fadeIn 0.18s ease',
    }}>
      <div className="gates-menu__tabs" style={{
        display: 'flex', alignItems: 'flex-end', gap: 2,
        padding: '22px 56px 0',
        borderBottom: '1px solid var(--border)',
        overflowX: 'auto',
      }}>
        {MENU_SECTIONS.map(s => {
          const active = router.menuSection === s.key;
          const onSelect = () => { if (s.supported) router.goMenu(s.key); };
          return (
            <div
              key={s.key}
              role="button"
              aria-disabled={!s.supported}
              onClick={onSelect}
              style={{
                padding: '11px 18px 12px',
                fontSize: 13,
                color: active ? 'var(--text)' : s.supported ? 'var(--text-dim)' : 'var(--text-faint)',
                opacity: s.supported ? 1 : 0.5,
                borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                marginBottom: -1,
                cursor: s.supported ? 'pointer' : 'default',
                whiteSpace: 'nowrap',
                userSelect: 'none',
              }}
            >
              <span>{s.label}</span>
              {!s.supported && s.badge && <span style={badgeStyle}>{s.badge}</span>}
            </div>
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
