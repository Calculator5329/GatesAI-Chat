# Wiring up the "Coming soon" surfaces

There are three places in the menu marked "Coming soon". This design wires the
easy ones to real state and trims the rest down to what we can honestly show.

## 1. Profile — flip to supported

`menuSectionMeta.ts` currently has Profile `supported: false` with a Coming-soon
badge, but the section itself is mostly real:

- **Memory** subsection — fully wired to `userProfileStore`.
- **Recent conversations** subsection — wired to `chat.threads`.
- **Account / Plan / Sessions** cards — hardcoded fake data ("Bill Gates",
  "Visa ending in 4242", "MacBook Pro · Seattle").

**Change:** flip `supported: true`, drop the `badge`, and delete the three fake
cards. Profile becomes Memory + Recent conversations only.

If the user ever wants account/plan/sessions, they come back as a separate
feature with a real backing store — not as a refresh of fake data.

## 2. API → Routing → Default provider

Today the per-message model picked in the composer determines `model.providerId`,
and the router (`src/services/llm/router.ts`) tries that provider's direct key
first, then falls back to OpenRouter if the user has an OR key and the model is
mappable.

**The "Default provider" dropdown will become: which provider wins when both a
direct key and an OpenRouter key are configured.** Two values in v1:

- `direct` (today's behavior): direct key first, OR fallback. Default.
- `openrouter`: route through OR whenever an OR slug exists, even if the
  direct key is set. Useful for users who want unified billing/logging.

Implementation:

- Add `routing.defaultProvider: 'direct' | 'openrouter'` to the existing
  settings persistence (wherever `ProviderConfigs` lives — likely
  `ProviderStore`). Default `'direct'`.
- `LlmRouter.resolve()` reads it. When `'openrouter'`, attempt the OR slug
  before the direct provider, and only fall through to direct if OR isn't
  ready or there's no slug.
- `RoutingCard.tsx`: drop "Coming soon" pill, enable the Default provider
  Select, simplify its options to two (Auto / direct, OpenRouter unified).
  Leave "Fallback when no key" and "Monthly spend cap" disabled with the pill
  — both depend on work outside this scope.

The other dropdown options (anthropic/openai/gemini/groq/local) are removed
because "force everything through Anthropic" doesn't make sense — the model
list already constrains the provider per-call.

## 3. Usage — make it real (no dollars)

Today's Usage section is entirely synthetic. We have real data for everything
*except cost*:

- assistant messages: `{ model, createdAt, content }`
- user messages: `{ content, createdAt }`
- `estimateTokens(content)` — the same heuristic used by the context meter

**v1 Usage shows, derived from `chat.threads`:**

- **Header tiles:** Tokens in (sum user content), Tokens out (sum assistant
  content), Messages (assistant message count), Threads (unique threads with
  ≥ 1 message). "This month" goes away — show "All-time" with a tiny
  `since <oldest>` subtitle.
- **Daily activity · last 30 days:** bar chart of assistant message count per
  day for the last 30 days. (Not "spend" — "messages".)
- **By model:** group assistant messages by `model`, show share, total
  tokens out, call count. Sort by share desc.
- **Recent invoices:** removed.
- **Billing-period kicker:** removed.

Everything is computed live from threads in memory. No new store, no
persistence, no pricing layer. If/when real cost tracking lands, the tiles
swap labels.

`menuSectionMeta.ts`: flip Usage `supported: true`, drop badge.

## Files touched

- `src/components/menu/menuSectionMeta.ts` — flip Profile and Usage to supported.
- `src/components/menu/sections/Profile.tsx` — delete Account/Plan/Sessions cards.
- `src/components/menu/sections/Usage.tsx` — full rewrite against real data.
- `src/components/menu/sections/api/RoutingCard.tsx` — enable Default provider, simplify options.
- `src/stores/ProviderStore.ts` (or wherever provider config persists) — add `defaultProvider`.
- `src/services/llm/router.ts` — honor `defaultProvider` in `resolve()`.

## Out of scope

- Real cost/pricing telemetry.
- Monthly spend cap (needs cost telemetry).
- "Fallback when no key" toggle (the existing OR fallback already covers this).
- Account / Plan / Sessions UI.
