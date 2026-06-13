# UX Principles

## 1. Calm canvas first

The default surface should feel like an editorial workspace, not a control
panel. The user should see conversation, useful outputs, and only the controls
needed for the current moment.

Use settings and expandable details for complexity.

## 2. Power is progressive

Most users do not want to watch every tool call all the time. They do want to
inspect what happened when something matters.

Default:

- Summarize actions inline.
- Keep logs and raw payloads collapsed.
- Show concise errors.
- Let users expand for details.

## 3. No fake assistant clutter

Background system events should not look like fresh assistant thoughts.

Examples:

- Image generation completion should update the image card.
- Tool status should appear as activity, not random assistant prose.
- Errors should be compact banners or card states, not pasted raw JSON.

## 4. Capability-aware UI

The app should only offer what can work in the current runtime.

Examples:

- Web Lite should not expose bridge-only tools.
- ComfyUI controls should explain setup when ComfyUI is unavailable.
- Ollama model choices should match local runtime status.
- The model should not receive tools that the runtime cannot execute.

## 5. Tested choices before infinite choice

The model picker should lead with tested good choices. Full catalogs can exist,
but they should not be the first mental burden.

Preferred order:

1. Best default.
2. Tested recommended models.
3. Provider/family groups.
4. Full catalog for advanced users.

## 6. Local ownership should be visible but not noisy

The product is about owning your keys, files, models, and data. That should be
clear in setup, workspace, and settings, but the chat surface should stay quiet.

Good copy:

- "Your OpenRouter key is stored locally."
- "Desktop features use your local workspace."
- "ComfyUI runs on your machine."

Avoid turning every screen into a security lecture.

## 7. Errors should suggest the next move

Error text should answer:

1. What happened?
2. What can I try next?
3. Where can I see details?

Example:

```txt
OpenRouter 402: credits or token limit hit.
Try adding credits, choosing a cheaper model, or lowering max tokens.
Details
```

## 8. The desktop app is the real product

Web Lite should be honest and useful, but Desktop should be where the product
feels complete. Any bridge-dependent feature should point toward Desktop rather
than pretending to work in the browser.

## 9. The assistant can work, but the user stays in control

For local actions, source edits, rebuilds, installs, and future plugins:

- Show what changed.
- Require approval for high-impact steps.
- Keep outputs inspectable.
- Do not silently modify the live installed app.

## 10. LEGO blocks over tangled workflows

When adding a feature, prefer a small block that snaps into existing blocks:

- Add or update a capability.
- Add a provider adapter.
- Add a service.
- Add a store action.
- Add UI that reads from the store.
- Add tests for the boundary.

Avoid scattering one feature across unrelated files without a clear owner.
