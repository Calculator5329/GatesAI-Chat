# User Journeys

These journeys describe how the product should feel from the user's point of
view. They are not implementation tickets by themselves, but they guide tickets.

## Journey 1: Web Lite demo

User goal:

Try the app quickly from a link, feel the smooth chat experience, and understand
why Desktop is worth installing.

Expected path:

1. User opens the Web Lite URL.
2. App shows the real chat interface, not a marketing page.
3. User adds an OpenRouter key.
4. User sends a simple prompt.
5. User can try different tested LLMs in different chats, or switch model
   families mid-chat when the selected models support the current task.
6. User can generate browser-safe inline artifacts, such as HTML previews, when
   available.
7. App explains that local files, shell, ComfyUI, and desktop-only powers need
   the Desktop app.
8. User sees a clear download path.

What the app should hide:

- Bridge-only tools.
- Broken local runtime controls.
- Any tool the web runtime cannot actually use.

Success moment:

The user thinks, "This feels polished, I can switch models without changing
apps, and Desktop is where the local powers unlock."

Failure states to design:

- No OpenRouter key.
- Browser storage unavailable.
- User asks for a desktop-only action.

## Journey 2: Desktop first run with OpenRouter

User goal:

Install the desktop app and choose the right starting path: OpenRouter, local
models, or both.

Expected path:

1. User installs Desktop.
2. App opens to a calm empty thread.
3. App presents two first-class paths: connect OpenRouter or connect local
   runtimes.
4. OpenRouter remains the easiest default path for broad model access.
5. Local setup is presented as equally legitimate for users who want local
   ownership, privacy, or lower ongoing cost.
6. App recommends the best tested default model for the chosen path.
7. User can open the model picker for tested alternatives.
8. User sends a message.
9. App streams an answer and keeps tool details quiet unless expanded.

What the app should hide:

- Full provider catalogs by default.
- Debug logs.
- Runtime setup that is not relevant yet.

Success moment:

The user thinks, "This is my AI app. I can pay for cloud usage, use local
models, or mix both."

Failure states to design:

- Invalid key.
- Provider 402 or token limit.
- Model lacks tools or vision.
- OpenRouter outage.

## Journey 3: Local model setup with Ollama

User goal:

Use a local model when privacy, cost, or offline work matters.

Expected path:

1. User opens local runtime settings.
2. App detects whether Ollama is available.
3. If missing, app explains the smallest next step.
4. If available, app lists local models.
5. User picks a tested or known-compatible local model.
6. Chat works with clear capability limits.

What the app should hide:

- Cloud model assumptions.
- Tools that the selected local model cannot reliably call.

Success moment:

The user thinks, "I can run this on my own machine and still use the same chat
surface."

Failure states to design:

- Ollama not installed.
- Ollama installed but no models pulled.
- Local model does not support tools.
- Local model gives malformed tool calls.

## Journey 4: Image generation

User goal:

Generate images using either cloud OpenRouter images or local ComfyUI.

Expected path:

1. User asks for an image.
2. App chooses the configured image backend.
3. Chat displays an image job card immediately.
4. Progress updates in the card.
5. If progress reaches the synthetic cap, the card says "Waiting on provider"
   with elapsed time.
6. Completion updates the same card with the image.
7. Gallery stores completed work.

What the app should hide:

- Raw provider JSON as the main error text.
- Extra assistant prose like "Here it is" detached from the card.

Success moment:

The user thinks, "The image job is a real object I can watch, open, and find
again later."

Failure states to design:

- OpenRouter credits or token limit.
- ComfyUI offline.
- Missing ComfyUI model files.
- Long wait with no provider events.

## Journey 5: Workspace actions

User goal:

Let the assistant work with local files in its own safe folder.

Expected path:

1. User asks the assistant to create, inspect, or modify a file.
2. App exposes workspace tools only if Desktop bridge is ready.
3. Assistant performs the action in `/workspace`.
4. Activity rows summarize what happened.
5. User can expand details when they want proof.

What the app should hide:

- Shell logs unless relevant.
- Tools unavailable in Web Lite or bridge-offline states.
- The workspace folder most of the time. It should appear naturally when the
  assistant uses it and remain available in settings for users who want to
  inspect it.

Success moment:

The user thinks, "It can actually do work, and I can still see what happened
when I care."

Failure states to design:

- Bridge offline.
- Command not allowlisted.
- File path outside workspace jail.
- Long-running command timeout.

## Journey 6: Future self-improvement

User goal:

Ask GatesAI to add or change a feature in GatesAI itself.

Expected path:

1. User opens a source-workspace mode.
2. Desktop install includes, or can prepare, a copy of the source that builds
   GatesAI Chat.
3. Assistant works inside that source copy rather than the live installed app.
4. Assistant edits files as needed.
5. App runs the build script.
6. Build produces a new EXE.
7. User reviews output and chooses whether to install the new build.

What the app should hide:

- Dangerous direct edits to the live installed app.
- Build logs unless expanded.

Success moment:

The user thinks, "The app can help me customize itself, but I am still the one
approving the upgrade."

Failure states to design:

- Source workspace unavailable.
- Tests fail.
- Build fails.
- Installer generation fails.
- User cancels before install.
