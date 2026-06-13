# User Stories

These stories turn the product direction into buildable checks. Priorities are
relative to the current GatesAI direction.

| Priority | Story | Acceptance criteria |
| --- | --- | --- |
| P0 | As a Web Lite visitor, I want to try chat quickly with my own OpenRouter key so I understand the product before installing. | Web Lite accepts an OpenRouter key, allows chat with supported web-safe features, hides bridge-only tools, and links clearly to Desktop. |
| P0 | As a desktop user, I want repeated screenshot uploads to remain distinct so my chat history is trustworthy. | Uploading three files named `image.png` returns three unique workspace paths, renders three distinct previews, and never overwrites an earlier attachment. |
| P0 | As an image user, I want generated images to complete in the original image card so the conversation does not feel scrambled. | Completed image jobs update the existing card and do not append a normal assistant prose message. |
| P0 | As a user hitting OpenRouter limits, I want concise errors so I understand the fix. | OpenRouter 402 shows a short readable message, offers raw details through copy/details, and deduplicates repeated active banners. |
| P0 | As a desktop user, I want HTML artifacts to preview inside chat so generated mini apps and documents are usable. | Blob/data iframe artifacts render under the Tauri CSP without adding `allow-same-origin` to the sandbox. |
| P0 | As a user, I want the app to expose only tools that can work right now. | Web Lite, bridge offline, Ollama offline, ComfyUI offline, and missing web search key states all hide unavailable tools from the model. |
| P1 | As a user choosing a model, I want a trusted default and a tested model list so I do not need to understand the whole catalog first. | Model picker highlights the best default, separates tested models from full catalog options, and labels tool/vision/reasoning/cost capabilities. |
| P1 | As a local-model user, I want Ollama setup to feel small and understandable. | Local settings detect Ollama status, list local models, explain missing setup steps, and avoid exposing unsupported tool flows. |
| P1 | As an image user, I want OpenRouter images and local ComfyUI images to feel equally first-class. | Image backend choice is clear, both paths use the same job-card pattern, errors are backend-specific, and completed images appear in Gallery. |
| P1 | As a workspace user, I want the assistant to work in a safe folder that I can inspect. | Workspace is seeded with useful folders/docs, initialized as git when possible, and never auto-commits user artifacts by default. |
| P1 | As a power user, I want action details hidden until I expand them. | Tool activity is summarized inline, details are available on demand, and routine logs do not dominate the chat. |
| P1 | As a returning user, I want thread settings to persist without needing another chat mutation. | Model, context mode, thinking effort, title, pin/delete, metadata, usage, tool results, artifacts, and attachment ids survive reload. |
| P2 | As a customization user, I want a future plugin/addition system so GatesAI can grow around my workflow. | Product has a capability manifest and extension points that can later host user additions without scattering provider/tool logic. |
| P2 | As a self-improvement user, I want GatesAI to edit a duplicate source copy, test it, build it, and let me approve installation. | Source workspace flow separates duplicate edits from live app, runs tests/builds, shows results, and requires explicit user install/update approval. |

## Story format for future additions

Use this shape:

```txt
As a [type of user],
I want [capability],
so that [user value].

Acceptance:
- Concrete observable behavior.
- Important unavailable/error behavior.
- Persistence or safety expectation if relevant.
```
