# GatesAI Chat Project Style Prompt

Use this prompt when asking an AI assistant, designer, or engineer to create or modify UI for this project.

```text
You are working inside GatesAI Chat, a React 19 + Vite + TypeScript + Tauri 2 desktop/web-lite chat app. Match the existing product style exactly: a quiet, dark, editorial AI workspace that feels like a serious writing room and developer console, not a SaaS landing page.

Product Identity
- The app is named GatesAI.
- It is an AI chat workspace with threaded conversations, model/provider settings, local runtime controls, workspace attachments, image generation history, and agent memory.
- The first impression should be calm, text-forward, capable, and slightly literary.
- Avoid marketing-page composition, oversized decorative hero sections, playful mascots, bright gradients, and card-heavy dashboard clutter.

Core Stack And Architecture
- Frontend: React 19, TypeScript, Vite.
- Shell/runtime: Tauri 2 plus a browser-hosted Web Lite mode.
- State: MobX stores accessed through context hooks such as `useChatStore`, `useRouterStore`, `useUiStore`, `useRootStore`, etc.
- Styling: a mix of global CSS in `src/index.css`, CSS variables from `src/core/theme.ts`, shared inline token objects from `src/core/styleTokens.ts`, and small UI primitives in `src/components/ui/`.
- Heavy UI/rendering work is often lazy-loaded with `React.lazy` and `Suspense`.
- Components should present state and delegate side effects to stores/services. Stores own persistent state.

Visual Language
- Base theme is dark charcoal/graphite.
- Default app background is near black: `#050608`/`var(--bg)`, with very subtle radial light at the edges.
- Surfaces are quiet: `var(--panel)`, `var(--panel-2)`, `var(--panel-3)`, or transparent backgrounds with a thin `var(--border)`.
- Accent is emerald by default: `#3ecf8e`, exposed as `var(--accent)`, with `var(--accent-2)` and `var(--accent-glow)`.
- Other supported accent palettes exist: deep blue, violet, amber, rose, cyan, ivory. Do not hard-code green unless matching existing local component style.
- Borders are low contrast, usually `rgba(255,255,255,0.07)` or `var(--border)`.
- Use color sparingly for state, active navigation, progress, links, and status. Most text is white/gray.
- Error/danger tones use rose/red such as `#ff7597`, `#c96a6a`, or `#ffaaaa`.

Typography
- UI font: `"Geist", ui-sans-serif, system-ui, sans-serif`.
- Prose/editorial font: `"Source Serif 4", "Iowan Old Style", Georgia, serif`.
- Mono metadata/code font: `"Geist Mono", ui-monospace, monospace`.
- Chat/message prose should feel editorial: serif, 16-17px, line-height around 1.6-1.65.
- UI labels are compact: 10-13px, often uppercase with 0.08em-0.14em letter spacing.
- H1s in menu/settings are serif, around 28px, light weight, tight letter spacing.
- Use mono for tokens, counts, data slots, paths, provider/status pills, and tiny metadata.
- Avoid giant display type except where the existing page already uses it.

Layout
- Main app shell is full viewport: `100vw` x `100dvh`, hidden overflow, fixed sidebar plus flexible content.
- Desktop sidebar width is 240px, transparent/dark, with a right border.
- Main chat uses a centered reading column. Existing width patterns are `min(var(--reading-width, 720px), 70%)` and composer width `min(750px, 70%)`.
- Chat scroll padding is generous on desktop: around `36px 48px`.
- Composer is anchored at the bottom with a compact input row and metadata row below.
- Menu pages use a top tab bar and a centered inner content width around 720px.
- Settings and provider pages are dense, structured, and scannable, not illustrative.
- Cards are allowed for individual panels/settings groups, but keep them flat and quiet. Do not nest cards.

Component Shape Rules
- Border radii are modest: 4-8px for most controls/cards, 10-12px for mobile touch surfaces, full pills only for status chips or round toggles.
- Buttons are small and utilitarian: 6px border radius, 6px 11px padding, 12px text.
- Default buttons are transparent with `1px solid var(--border)` and `var(--text)`.
- Accent buttons use `var(--accent)` fill and dark text such as `#06120a`.
- Danger buttons are transparent with rose/red borders and text.
- Inputs use `var(--panel)`, `var(--border)`, 6-7px radius, 12-13px UI font.
- Pills use inline-flex, 3px 8px padding, 99px radius, 11px mono, subtle tinted backgrounds.
- Toggles are tiny: 32x18 track, 14px knob, accent when on.
- Icons are custom 16x16 line icons in `src/components/ui/icons.tsx`, stroke around 1.5, currentColor. Prefer the existing `Icons` object.

Chat Surface
- Messages are separated with quiet bottom borders, 24px vertical padding, and fade in over ~180ms.
- Message headers are tiny uppercase metadata: 10px, 0.12em letter spacing.
- Assistant/model metadata uses accent color; user metadata uses faint text.
- Message body is serif, 16px, line-height 1.65, slightly tight letter spacing.
- Copy/regenerate/edit/branch actions appear as a small floating toolbar on hover/focus on desktop.
- Touch/coarse pointer layouts expose actions statically with larger hit targets.
- Empty chat state is centered, italic serif, faint: "A blank page. Say something."
- Streaming should feel smooth and calm: caret, subtle dots, and paced text reveal rather than flashing.
- Tool/activity rows are compact, mono-ish/system, faint by default, accent while running, red on failure.

Markdown And Code
- Markdown body supports editorial, technical, and compact modes.
- Editorial markdown uses serif body and headings. Technical markdown uses Geist.
- Code blocks are dark, bordered, 8px radius by default, with Geist Mono.
- Inline code is small, subtle, and lightly tinted.
- Workspace paths in inline code can become clickable chips/links with an arrow glyph and accent underline.
- Mermaid diagrams, tables, KaTeX, and syntax highlighting should fit the same quiet dark system.
- Horizontal rules are visually hidden; use spacing instead of heavy dividers.

Navigation And Menus
- Sidebar brand is "GatesAI" in serif, 22px, with a small accent dot.
- "Begin a new conversation" is a bordered, compact row button.
- Thread rows use active left border accent, subtle active background, title plus italic preview.
- Keep row action slots mounted or dimensionally stable so hover/focus does not reflow titles.
- Menu tabs are simple text buttons with bottom accent border for active state.
- Unsupported menu items may be dimmed and carry tiny uppercase badges.

Settings And Operational Screens
- Use `tokens.h1`, `tokens.kicker`, `tokens.section`, `tokens.sectionTitle`, `tokens.mono`, and shared UI primitives where possible.
- Section titles are tiny uppercase labels with letter spacing and a bottom border.
- Details are 11.5-12.5px dim text with 1.45-1.55 line height.
- Operational rows should use predictable labels, compact descriptions, and right/inline controls.
- Dangerous actions require a confirming state before execution.
- Status text should be concise and appear near the relevant controls.

Responsive Behavior
- Mobile breakpoint is roughly `max-width: 640px`, also handles short landscape at `max-width: 960px and max-height: 480px`.
- Mobile has a fixed top bar around 48px plus safe-area inset.
- Sidebar becomes a drawer with scrim, width `min(84vw, 336px)`, blur, and slide transition.
- Composer becomes fixed bottom, full width, with 16px gutter and touch-friendly 32px buttons.
- Mobile controls use larger hit targets: 34-44px, radii around 9-12px.
- Text must truncate cleanly with ellipsis where space is limited.
- Avoid layout shifts on hover, focus, scrollbars, streaming, and dynamic status changes.

Motion And Interaction
- Motion is subtle and quick: 100-190ms transitions, 180ms fade-in/slide-up.
- Respect `.no-animations` by ensuring animations/transitions can be disabled globally.
- Hover states should increase contrast slightly, usually by adding low-opacity white or accent mix.
- Focus-visible states should be visible but not loud.
- Streaming/running states can pulse or glow gently with `var(--accent-glow)`.
- Use passive scroll listeners and requestAnimationFrame where needed for performance-sensitive scrolling.

Content Voice
- Keep UI copy concise, direct, and humane.
- Empty states can be slightly literary but short.
- Settings copy should be practical and reassuring.
- Avoid promotional language, hype, and long feature explanations inside the UI.
- Prefer concrete labels like "Open API settings", "Clear browser cache", "Begin a new conversation".

Implementation Preferences
- Reuse existing CSS variables: `--accent`, `--accent-2`, `--accent-glow`, `--bg`, `--panel`, `--panel-2`, `--panel-3`, `--border`, `--text`, `--text-dim`, `--text-faint`.
- Reuse `src/components/ui` primitives when they fit: `Button`, `Card`, `Pill`, `Input`, `Select`, `SegmentedControl`, `SecretKeyField`, `Textarea`, `SettingsRow`, `Toggle`.
- Reuse `tokens` from `src/core/styleTokens.ts` for page titles, kickers, section labels, mono text, and numeric display.
- Keep components controlled and lightweight. Avoid introducing a new styling framework.
- Inline styles are common in this codebase for component-local surfaces; global CSS is used for larger app-wide classes and responsive overrides.
- Keep state in MobX stores/services. Components derive view state and call store actions.
- Preserve accessibility labels, titles, keyboard handling, and disabled states.
- Avoid unrelated refactors.

Design Do Not List
- Do not create a landing page or marketing hero inside the app.
- Do not use bright, full-screen gradients, decorative blobs, or glassmorphism as the dominant look.
- Do not introduce large rounded cards everywhere.
- Do not use a single loud color palette. The app is dark-neutral with a restrained accent.
- Do not make hover/focus states change element dimensions.
- Do not use bulky text buttons where an existing icon affordance fits.
- Do not over-explain features with visible instructional copy.
- Do not break the editorial reading rhythm of chat messages.

When asked to build new UI, first identify whether it belongs to the chat/editorial surface, the sidebar/navigation shell, or the operational menu/settings surface. Then choose the matching local patterns above and implement the smallest coherent change that feels native to GatesAI.
```

## Style Review Summary

GatesAI Chat has a strong and consistent design identity: dark editorial workspace, compact operational controls, and prose-first conversation rendering. Its strongest style markers are the serif chat body, tiny uppercase metadata, subdued borders, and accent-as-status language. The app feels intentionally quiet.

The visual system is currently split across global CSS, theme variables, inline component style objects, and a few shared primitives. That split is workable because the product is small and hand-tuned, but new work should consciously reuse the existing tokens and primitives to avoid accidental visual drift.

The biggest rule for future work is restraint. New screens should be dense, calm, text-first, and built for repeated use. The app should feel like a personal AI workshop: polished, responsive, and a little literary, without becoming decorative.
