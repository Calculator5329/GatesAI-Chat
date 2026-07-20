# GatesAI owner feedback session — 2026-07-20

## What this is

**Claim:** the recent GatesAI depth pass is ready for one joined-up owner review,
and the review machinery itself is ready to be tested.

This session presents the same shipped work through six feedback routes so the
product and the developer-in-the-loop system can be judged separately. The
three rich artifacts are deliberately different interactions, not cosmetic
variants of one mockup.

What changed in this review package:

- one guided hands-on path through the running product;
- one code-derived evidence board for fast scanning and rating;
- one speech-first challenge deck for conversational feedback;
- a real Forge rich-artifact choice plus the ordinary packet evidence;
- a shared rubric for comparing Comms Deck, Visions, and in-chat feedback too.

No GatesAI product source changed while preparing this package.

## Open this first

Start with the rich Forge packet from Comms Deck (`Super+I`) and choose one of
the three `review-flow` options. If you are opening the repository directly,
use one of these files:

1. [A — Guided missions](../../../artifacts/gatesai-owner-feedback-session-20260720/guided-missions.html)
2. [B — Evidence board](../../../artifacts/gatesai-owner-feedback-session-20260720/evidence-board.html)
3. [C — Speech-first challenge deck](../../../artifacts/gatesai-owner-feedback-session-20260720/speech-first.html)

Then spend a short pass in the *other two*. The point is not to repeat a full
QA run three times; it is to notice which route gets you to high-quality
feedback with the least friction.

Use the running GatesAI app for the missions. The HTML files are offline review
guides: they do not call GatesAI, launch a build, or submit feedback.

## The three modes

### A — Guided missions

Best for verifying behavior. It gives seven ordered “do this / look for this /
react to this” missions and a visible completion trail.

### B — Evidence board

Best for fast comparative judgment. It lays the seven areas out at once with
the product claim, implementation evidence, trust question, and a local rating.

### C — Speech-first challenge deck

Best for nuance and taste. It shows one provocation at a time, gives a short
prompt to say aloud, and builds a copyable spoken-review transcript.

All three cover identical subject matter. Their information architecture,
navigation, and feedback affordances are intentionally different.

## Coverage map

| Review area | A — mission | B — evidence | C — spoken challenge | Current evidence |
| --- | --- | --- | --- | --- |
| Agent feel | Complete a real turn | Judge the agent-loop claim | Describe where it feels mechanical | `chatTurnEngine.ts`, `agentTaskLifecycle.ts` |
| Composer + activity | Trigger a tool step | Rate intent transparency | React to the visible purpose phrase | `activityProjection.ts`, `activityDisplay.ts` |
| Local models + prompt | Inspect Ollama and instructions | Judge honest local-state copy | Explain the desired local-first feel | `OllamaStore.ts`, `userSystemPrompt.ts` |
| Semantic memory | Inspect source chips and controls | Rate provenance and reversibility | Say what the app may remember | `services/rag/`, `MemoryDisclosure.tsx` |
| Brave search | Try quick search and Research | Compare two search budgets | State when deep research earns its cost | `braveClient.ts`, `deepResearch.ts` |
| Model compatibility | Inspect the latest report | Rate the curated-green policy | Say what “supported” should promise | `scripts/model-compat/` |
| Knowledge library | Approve and disable a source | Judge the document/database split | Describe the safe library mental model | `services/tools/library.ts`, `services/library/` |

## How Ethan records feedback

There are six write-back routes in this experiment:

1. **Rich Forge packet:** choose A, B, or C in the grouped artifact control and
   add a short annotation. Forge writes the choice to the packet-local
   `decision.json`.
2. **Artifact notes:** each HTML mode keeps notes only in that open page and
   builds a plain-text transcript for copying. It says plainly when nothing has
   been submitted.
3. **Comms Deck card:** use the single “GatesAI feedback session” start card as
   the doorway; the existing feature cards remain useful for focused retries.
4. **Visions:** open the GatesAI vision and use the structured direction or
   choice control on the owner-review item. If Visions is not running, launch
   the installed Project Hub first; its normal local address is
   `localhost:4400`.
5. **In chat:** speak one pass over these five subjects: overall agent feel;
   memory/library; search/research; local models and tool activity; best review
   medium. The developer writes the literal reaction back as a feedback packet.
6. **Direct edits:** mark the rubric below or in `rubric.md` when you want a
   durable, inspectable comparison without any UI.

The three HTML artifacts never pretend to submit. “Build transcript” only
formats notes already in the current page; closing or refreshing the file
clears them unless you copied the result.

## Comparison rubric

Score 1–5 after trying the modes.

| Mode | Speed | Clarity | Trust | Taste feedback | Completion effort |
| --- | ---: | ---: | ---: | ---: | ---: |
| A — Guided missions |  |  |  |  |  |
| B — Evidence board |  |  |  |  |  |
| C — Speech-first challenge deck |  |  |  |  |  |
| Standard Forge review packet |  |  |  |  |  |
| Visions structured input |  |  |  |  |  |
| In-chat spoken review |  |  |  |  |  |

Judge **speed** to first useful reaction, **clarity** of the ask, **trust** in
the evidence and write-back, ability to capture **taste**, and total
**completion effort**. Finish with: “Use ___ by default; keep ___ for ___.”

## Exact evidence and honest uncertainty

- Product truth: `docs/changelog.md`, `docs/roadmap.md`, and the source paths in
  the coverage map.
- Visual truth: `docs/screens/desktop-mocked/03-chat-tool-activity.png`,
  `04-chat-memory-disclosure.png`, `07-menu-agent.png`, and `08-menu-models.png`.
- Forge truth: the generated packet contains the run record, verification
  result, diff evidence, and copied self-contained artifacts.
- Uncertainty: this package proves that the review surfaces render and that the
  documented product tests previously passed. It does not replace tomorrow’s
  hands-on judgment, live provider credentials, or a fresh paid model probe.

## Verdict

Choose one for the GatesAI work: **accept**, **changes requested**, **reject**,
or **defer**. Separately choose the review route you want as the default.

## What was NOT changed

- no product code, settings, provider credentials, or user data;
- no new background service or network call;
- no restoration of parked Schedules, Source workspace, MCP, or Web Lite work;
- no claim that the current packet replaces hands-on testing in the app.
