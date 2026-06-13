# GatesAI Handbook

This handbook is the plain-English map for GatesAI Chat. Use it when you want
to understand what the product is, who it is for, how the codebase fits
together, and where the refactor is going.

The older docs are still useful as reference material. This folder is the
front door.

## Reading order

1. [Product Brief](./product-brief.md)
   - What GatesAI is, who it serves, what makes it different, and how Web Lite
     and Desktop relate to each other.
2. [Codebase Tour](./codebase-tour.md)
   - The code explained as simple LEGO blocks: UI, stores, services, core,
     bridge, providers, tools, artifacts, and workspace.
3. [User Journeys](./user-journeys.md)
   - How real users should move through the product from first run to local
     models, images, files, and future self-improvement.
4. [User Stories](./user-stories.md)
   - Buildable product stories with acceptance criteria.
5. [UX Principles](./ux-principles.md)
   - The design rules that keep the app calm, powerful, and understandable.
6. [Glossary](./glossary.md)
   - Short definitions for the project words that show up everywhere.

## Deeper technical references

- [Architecture](../architecture.md)
- [Tech Spec](../tech_spec.md)
- [Roadmap](../roadmap.md)
- [Changelog](../changelog.md)
- [Quick Setup](../quick-setup.md)
- [ComfyUI Setup](../comfyui-setup.md)
- [Audit Notes](../audits/2026-06-07-comprehensive-audit.md)

## The one-sentence product direction

GatesAI Chat is a local-first AI workbench for AI-capable users who want to
bring their own keys, bring their own local models, own their files, generate
images, and let the assistant do real computer work without getting trapped in
one provider ecosystem.

## The one-sentence code direction

The codebase should become a small set of clear blocks that snap together:
capabilities describe what is available, stores hold state, services do work,
providers talk to models, tools perform actions, and the chat engine coordinates
turns without owning every detail itself.
