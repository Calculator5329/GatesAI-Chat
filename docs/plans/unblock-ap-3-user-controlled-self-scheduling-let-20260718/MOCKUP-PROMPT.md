# AP-3 mockup generation record

Tool path: built-in image generator  
Taxonomy: `ui-mockup`  
Output: [mockups/schedule-layouts.png](./mockups/schedule-layouts.png)  
Dimensions: 1536 × 1024  
SHA-256: `2734999bcfea9c8bfd057519da9bd2886e287749ae63062b2798a5cd44c53c05`

## Final prompt

```text
Use case: ui-mockup
Asset type: six-option contact sheet for a desktop AI workspace schedule-management and schedule-approval design review
Primary request: Create ONE high-fidelity 3 columns × 2 rows contact sheet containing six genuinely divergent compact GatesAI schedule interfaces, labeled A through F. Each variant must show both an agent-created schedule awaiting user approval and an existing active schedule with pause, edit, run now, and archive controls. Variants must differ materially in information hierarchy, density, approval flow, cadence visualization, budget/tool disclosure, and activity/history placement.
Scene/backdrop: GatesAI Chat desktop app, calm editorial dark UI, Agent menu or right-side task-center adjacent to a dimly visible conversation
Style/medium: polished product UI mockup, crisp and readable, restrained late-night workbench rather than enterprise dashboard
Composition/framing: 3×2 evenly spaced contact sheet, same scale, clear labels A–F outside interactive controls. Include these divergent patterns: A compact stacked cards with expandable details; B timeline-first schedule list; C split proposal inbox and active schedules; D calendar/rhythm visualization; E task-ledger rows with disclosure drawer; F conversation-inline approval card plus compact Agent menu list
Lighting/mood: calm at 11pm, low glare, quiet power, user-controlled and transparent
Color palette: charcoal, warm off-white text, muted emerald for active/approved, restrained amber for pending consent or budget stop, red only for exceptional failure
Text (verbatim where visible): “Runs only while GatesAI is open”, “Approve schedule”, “Pause all”, “Run now”, “Every day · 9:00 AM”, “Ollama · qwen2.5:7b”, “$0.50 / wake”, “4 wakes / 24h”, “Read files”, “Pending approval”
Constraints: make exact route, next wake, timezone, tool grants, spend cap, wake cap, last result, and catch-up choice visible or available via progressive disclosure; approval must be a specific action, not a generic automation toggle; controls work at a narrow panel width; no hidden activation
Avoid: enterprise admin tables, calendar app clone, cron syntax as primary UI, neon cyberpunk, glassmorphism, gradients, oversized cards, generic SaaS dashboard, tiny illegible copy, watermark
```

## Selection

Use **A** as the persistent Agent-menu layout: one prominent pending-proposal
card, compact active cards, progressive detail, and an always-visible global
pause. Use **F** only for the conversation-inline proposal card created by the
model-facing tool. The inline card and Agent-menu card are two projections of
the same persisted schedule ID, never two consent records.

Reject B/D because timeline and rhythm graphics spend space without improving
approval comprehension. Reject C because a permanent two-column proposal
inbox makes a small personal surface feel administrative. Reject E because a
ledger table is already the Task Center's visual language; schedules are
definitions, while each fired wake becomes the ordinary task-ledger row.

