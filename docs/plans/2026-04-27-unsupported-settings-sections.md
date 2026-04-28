# Unsupported Settings Sections Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Gray out unsupported settings tabs and unsupported controls so users can immediately tell which settings are live versus placeholders.

**Architecture:** Keep the support status in one menu-facing source of truth so the top tab bar and individual sections cannot drift. Live sections stay interactive; unsupported sections render as visibly muted, non-clickable tabs with a small status badge, while placeholder controls inside otherwise-live sections continue using explicit disabled styling in-section.

**Tech Stack:** React 19, TypeScript, MobX, inline style tokens, Vitest + jsdom

---

### Task 1: Define the settings support matrix

**Files:**
- Create: `src/components/menu/menuSectionMeta.ts`
- Modify: `src/components/menu/GatesMenu.tsx`
- Test: `tests/components/menu/GatesMenu.test.tsx`

**Step 1: Write the failing test**

```ts
it('renders unsupported menu tabs as disabled and non-clickable', () => {
  const store = buildStore();
  store.router.goMenu('profile');
  const rendered = renderMenu(store);

  const usageTab = findTab(rendered, 'Usage');
  expect(usageTab?.getAttribute('aria-disabled')).toBe('true');
  expect(usageTab?.style.cursor).toBe('default');

  act(() => usageTab?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  expect(store.router.menuSection).toBe('profile');
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/components/menu/GatesMenu.test.tsx`

Expected: FAIL because the current tab strip treats every section as clickable and exposes no support metadata.

**Step 3: Write minimal implementation**

```ts
export interface MenuSectionMeta {
  key: MenuSectionKey;
  label: string;
  component: ComponentType;
  supported: boolean;
  badge?: 'Coming soon';
}

export const MENU_SECTIONS: MenuSectionMeta[] = [
  { key: 'profile', label: 'Profile', component: ProfileSection, supported: false, badge: 'Coming soon' },
  { key: 'agent', label: 'Agent', component: AgentSection, supported: false, badge: 'Coming soon' },
  { key: 'workspace', label: 'Workspace', component: WorkspaceSection, supported: true },
  { key: 'settings', label: 'Settings', component: SettingsSection, supported: true },
  { key: 'usage', label: 'Usage', component: UsageSection, supported: false, badge: 'Coming soon' },
  { key: 'local', label: 'Local', component: LocalSection, supported: true },
  { key: 'api', label: 'API', component: ApiSection, supported: true },
  { key: 'gallery', label: 'Gallery', component: GallerySection, supported: true },
  { key: 'appearance', label: 'Appearance', component: AppearanceSection, supported: true },
];
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/components/menu/GatesMenu.test.tsx`

Expected: PASS, with unsupported tabs now exposing disabled semantics and refusing route changes on click.

**Step 5: Commit**

```bash
git add src/components/menu/menuSectionMeta.ts src/components/menu/GatesMenu.tsx tests/components/menu/GatesMenu.test.tsx
git commit -m "feat: mark unsupported settings sections"
```

### Task 2: Apply the disabled tab treatment in the menu shell

**Files:**
- Modify: `src/components/menu/GatesMenu.tsx`
- Test: `tests/components/menu/GatesMenu.test.tsx`

**Step 1: Write the failing test**

```ts
it('shows a visual coming-soon treatment for unsupported tabs', () => {
  const store = buildStore();
  const rendered = renderMenu(store);

  const profileTab = findTab(rendered, 'Profile');
  expect(profileTab?.textContent).toContain('Coming soon');
  expect(profileTab?.style.opacity).toBe('0.5');
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/components/menu/GatesMenu.test.tsx`

Expected: FAIL because unsupported tabs currently render exactly like live tabs except for active state.

**Step 3: Write minimal implementation**

```ts
const onSelect = () => {
  if (!section.supported) return;
  router.goMenu(section.key);
};

<div
  role="button"
  aria-disabled={!section.supported}
  onClick={onSelect}
  style={{
    padding: '11px 18px 12px',
    color: active ? 'var(--text)' : section.supported ? 'var(--text-dim)' : 'var(--text-faint)',
    opacity: section.supported ? 1 : 0.5,
    cursor: section.supported ? 'pointer' : 'default',
    borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  }}
>
  <span>{section.label}</span>
  {!section.supported && <span style={badgeStyle}>Coming soon</span>}
</div>
```

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/components/menu/GatesMenu.test.tsx`

Expected: PASS, with unsupported sections visually muted and clearly labeled.

**Step 5: Commit**

```bash
git add src/components/menu/GatesMenu.tsx tests/components/menu/GatesMenu.test.tsx
git commit -m "feat: gray out unsupported settings tabs"
```

### Task 3: Keep unsupported controls muted inside otherwise-live sections

**Files:**
- Modify: `src/components/ui/SettingsRow.tsx`
- Modify: `src/components/menu/sections/api/RoutingCard.tsx`
- Modify: `src/components/menu/sections/Agent.tsx`
- Test: `tests/components/menu/GatesMenu.test.tsx`

**Step 1: Write the failing test**

```ts
it('renders placeholder controls with a disabled row style', () => {
  const store = buildStore();
  store.router.goMenu('api');
  const rendered = renderMenu(store);

  expect(rendered.textContent).toContain('Routing');
  expect(rendered.textContent).toContain('Coming soon');
  const disabledSelect = rendered.querySelector('select:disabled') as HTMLSelectElement | null;
  expect(disabledSelect).not.toBeNull();
});
```

**Step 2: Run test to verify it fails**

Run: `npm run test -- tests/components/menu/GatesMenu.test.tsx`

Expected: FAIL if the row wrapper does not expose a consistent disabled treatment around already-disabled controls.

**Step 3: Write minimal implementation**

```ts
interface SettingsRowProps {
  label: string;
  last?: boolean;
  disabled?: boolean;
  children: ReactNode;
}

export function SettingsRow({ label, last, disabled, children }: SettingsRowProps) {
  return (
    <div style={{ opacity: disabled ? 0.5 : 1 }}>
      <div style={{ color: disabled ? 'var(--text-faint)' : 'var(--text-dim)' }}>{label}</div>
      <div style={{ color: disabled ? 'var(--text-dim)' : 'var(--text)' }}>{children}</div>
    </div>
  );
}
```

Apply `disabled` to:
- `RoutingCard` rows, because that card is already explicitly unwired.
- The clearly planned-only controls in `Agent` (`Default model`, `Temperature`, `Reasoning effort`, `Formality`, `Length`, `Emoji use`) if they are confirmed to be display-only rather than store-backed.

Do **not** gray out rows backed by real stores:
- `Agent` instructions textarea
- `Profile` memory editor
- `Settings` shortcuts and danger zone
- `Appearance`, `Local`, `Workspace`, `Gallery`

**Step 4: Run test to verify it passes**

Run: `npm run test -- tests/components/menu/GatesMenu.test.tsx`

Expected: PASS, and the in-section placeholders now match the disabled-tab language.

**Step 5: Commit**

```bash
git add src/components/ui/SettingsRow.tsx src/components/menu/sections/api/RoutingCard.tsx src/components/menu/sections/Agent.tsx tests/components/menu/GatesMenu.test.tsx
git commit -m "feat: mute unsupported settings controls"
```

### Task 4: Update project docs and verify the shipped behavior

**Files:**
- Modify: `docs/roadmap.md`
- Modify: `docs/changelog.md`

**Step 1: Update roadmap status**

Change the near-term item from:

```md
- [ ] Wire the API / Settings / Agent menu sections to real state
```

to wording that reflects partial support accurately, for example:

```md
- [ ] Finish wiring unsupported settings sections; unsupported tabs now render as Coming soon instead of appearing interactive
```

**Step 2: Add changelog entry**

Add a dated note describing:

```md
- Unsupported settings tabs are now visibly dimmed and non-interactive.
- Placeholder controls inside live sections use the same muted treatment.
- Live sections such as Local, API provider keys, Appearance, Workspace, and Gallery remain fully interactive.
```

**Step 3: Run verification**

Run:
- `npm run test -- tests/components/menu/GatesMenu.test.tsx`
- `npm run typecheck`
- `npm run lint`

Expected:
- Targeted menu test passes
- TypeScript passes
- Lint passes with no new errors

**Step 4: Commit**

```bash
git add docs/roadmap.md docs/changelog.md
git commit -m "docs: record unsupported settings states"
```
