# Product Brief

## What GatesAI is

GatesAI Chat is a local-first AI workbench. It feels like a calm chat canvas,
but underneath it can use cloud models, local models, image generation, files,
terminal actions, web search, artifacts, MCP tool servers, and a controlled
workspace.

The simplest mental model:

```txt
ChatGPT-style conversation
+ local computer powers
+ bring-your-own models
+ own-your-data workspace
+ optional image generation
+ future self-improvement loop
```

## Core goals (the bar every change is measured against)

1. **Fast and performant.** Streaming feels instant, the UI never janks, long
   threads stay smooth. Perceived speed is a feature, not a nice-to-have.
2. **Easy and nice to use.** The surface reads like ChatGPT: type, send, read.
   Good UI/UX beats feature count. Power is progressive — hidden until wanted.
3. **Agentic depth on your machine.** Claude Code / Codex-style capabilities —
   files, terminal, git, SQLite, artifacts, image generation, MCP servers —
   scoped to a workspace the user owns and can inspect.
4. **Any model, your choice.** Any OpenRouter model, any local Ollama model.
   Switch mid-conversation. No model lock-in, no separate subscription.
5. **Offline-capable and local-only data.** With local models the app works
   with no internet. Everything the app stores lives on the user's device
   (localStorage + IndexedDB + the workspace folder); nothing is phoned home.
6. **Zero-friction start.** Download the exe → open → chat. No account, no
   config file, no developer environment. Every step between "downloaded" and
   "first useful answer" is a defect.

Design north stars: **t3.chat** for how fast and pleasant a chat surface can
feel; **Claude Code / Codex** for how trustworthy local agentic tooling should
behave (visible actions, scoped access, user in control).

## Who it is for

Primary audience:

- AI power users who are not full-time infrastructure people.
- Users who understand API keys, models, local tools, and files.
- People who want pay-as-you-go model access instead of another fixed
  subscription.
- People who want optional local models and local data ownership.
- People who like open-source customization, but do not want a huge setup tax.

Not the primary audience:

- Someone who has never used AI and wants a fully guided beginner product.
- Enterprise teams with large budgets and centralized admin needs.
- People who want every provider, every model, and every integration supported.

The product should feel like it is saying:

> You know enough to want control. GatesAI gives you that control without
> making you assemble the whole machine from loose parts.

## Core promise

GatesAI lets users bring their own OpenRouter key, use tested cloud models, use
local Ollama models, generate images through OpenRouter or local ComfyUI, and
work inside a local folder that they own.

The app should optimize for:

- Optionality without chaos.
- Local ownership without painful setup.
- Power tools hidden until they matter.
- Clear model choices instead of infinite unsupported choices.
- A calm editorial UI instead of a busy admin dashboard.

## The wow moment

The first wow moment should be:

```txt
I added my own key, picked a good model, asked it to do something real, and it
used its own workspace/files/tools without me building a developer environment.
```

Later wow moments:

- "I can switch models without switching apps."
- "I can use local models when I want privacy or no usage bill."
- "I can generate images locally with ComfyUI or use OpenRouter images."
- "I can inspect what it did when I care, but it stays quiet when I do not."
- "Eventually, I can ask it to improve itself by editing a duplicate source
  workspace and rebuilding the desktop app."

## Web Lite vs Desktop

Web Lite is the demo. Desktop is the product.

Web Lite should:

- Let someone understand the interface quickly.
- Showcase how smooth the chat surface feels.
- Let someone try chat with their own OpenRouter key.
- Show that chats can use different LLMs, including switching between tested
  model families without moving to another app.
- Show browser-safe artifacts such as inline generated HTML when available.
- Clearly explain what is missing without feeling broken.
- Push serious users to download Desktop.
- Be good enough for a resume link, portfolio review, or quick product tour.

Desktop should:

- Feel like the real local workbench.
- Own the local workspace.
- Use the bridge for files, shell, git, artifacts, and local runtime access.
- Support OpenRouter, Ollama, and ComfyUI/local image workflows.
- Let the user choose their setup path: OpenRouter key first, local runtime
  first, or both. OpenRouter can be the easiest default, but local should feel
  equally first-class on Desktop.
- Become the home for future self-editing and plugin/customization workflows.

## Provider strategy

The project should be selective on purpose.

Supported providers:

- OpenRouter for cloud LLMs and cloud image generation.
- Ollama for local LLMs.
- ComfyUI for local image generation.

The app should not chase every provider. The product value is "exactly the
choices that work well" rather than "everything technically possible."

Model picker direction:

- One best default.
- A tested curated list of top models from major families.
- Clear tags for tools, vision, reasoning, speed, and price.
- Full catalog later, but visually separated from the tested set.

## Future self-improvement loop

The long-term differentiator is a desktop app that can help improve itself.

The intended safe flow:

1. Ship the Desktop install with, or next to, a source copy that can build
   GatesAI Chat.
2. Give the assistant access to that source copy through a controlled source
   workspace.
3. Let the assistant inspect and edit those files.
4. Run the build script against that source copy.
5. Produce a new Desktop executable.
6. Let the user choose whether to install/update.

This should never feel like magic hidden in the walls. It should feel like a
transparent workshop where the assistant can help, but the user remains in
control.

## Future plugin direction

Plugins are out of scope for the immediate refactor, but the architecture should
leave room for them.

Internal capabilities and tools are the built-in GatesAI toolbelt. They should
always come with the app.

Future plugins are additions on top of that built-in toolbelt. A plugin might
add a new tool, a workflow, a UI panel, or a project-specific integration.
Eventually GatesAI may help create its own plugins, but the first goal is to
make the internal capability system clean enough that plugin boundaries are
obvious later.
