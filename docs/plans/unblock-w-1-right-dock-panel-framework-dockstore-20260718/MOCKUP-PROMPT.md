# Code-editor mockup generation record

Tool path: built-in image generator  
Taxonomy: `ui-mockup`  
Selected output: [mockups/code-editor-layouts.png](./mockups/code-editor-layouts.png)

## Final prompt

```text
Use case: ui-mockup
Asset type: six-option contact sheet for a desktop AI workbench right-dock code editor design review
Primary request: Create ONE high-fidelity 3 columns × 2 rows contact sheet containing six genuinely divergent compact right-dock code editor layouts, labeled A through F. Each panel is a narrow desktop side dock beside a calm chat surface, not a full IDE. Variants must differ materially in toolbar hierarchy, save-state placement, file path treatment, preview/edit balance, and conflict/error presentation. Show realistic TypeScript or Markdown code, line numbers, syntax coloring, and one or two restrained controls. Include variants: A minimal top toolbar; B bottom status rail; C split source/preview; D command-palette-first chrome; E dirty-state ribbon; F quiet inline save/error notice.
Scene/backdrop: GatesAI Chat desktop workbench, charcoal editorial UI, dark theme, right dock occupying roughly one third of width, conversation visible dimly to the left
Style/medium: polished product UI mockup, crisp readable interface, high fidelity, subdued and practical
Composition/framing: 3×2 evenly spaced contact sheet, each variant shown at the same scale, labels A–F clear and outside interactive controls
Lighting/mood: calm late-night work session, low glare, quiet power
Color palette: dark charcoal, warm off-white text, muted emerald accent, restrained amber only for unsaved/conflict state
Text (verbatim): "Save", "Saved", "Unsaved", "Reload", "Keep mine"
Constraints: one column with one editor cell per variant; no tabs-inside-panel; no file tree inside the editor; no terminal; no LSP/autocomplete popups; no browser chrome; controls remain usable at narrow width; preserve the GatesAI editorial identity
Avoid: VS Code clone, neon cyberpunk, glassmorphism, oversized buttons, dense IDE chrome, gradients, decorative illustrations, watermark
```

## Selection

Use A as the persistent layout. Borrow F's recovery rail only for errors and
external-change conflicts. The rationale and rejected variants are recorded in
`PLAN.md`.
