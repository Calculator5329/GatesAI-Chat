// Adapts browser UI requests to the local workspace bridge for defaultWorkspaceGuide.
// Called by stores and tools; depends on BridgeClient envelopes, workspace path contracts, and abortable requests.
// Invariant: bridge failures are surfaced as typed errors or user-readable strings.
interface BridgeRequestFacade {
  request<T = unknown>(op: string, data: unknown): Promise<T>;
}

const ROOT_README_PATH = '/workspace/README.md';
const AI_GUIDE_PATH = '/workspace/notes/GatesAI-AI-Operating-Context.md';
const ROOT_GITIGNORE_PATH = '/workspace/.gitignore';

export async function ensureDefaultWorkspaceGuide(client: BridgeRequestFacade): Promise<void> {
  await safeRequest(client, 'fs.mkdir', { path: '/workspace/notes' });
  await safeRequest(client, 'fs.mkdir', { path: '/workspace/artifacts' });
  await safeRequest(client, 'fs.mkdir', { path: '/workspace/attachments' });
  await ensureFile(client, ROOT_README_PATH, ROOT_README);
  await ensureFile(client, ROOT_GITIGNORE_PATH, ROOT_GITIGNORE);
  await writeManagedFile(client, AI_GUIDE_PATH, AI_OPERATING_CONTEXT);
  await safeRequest(client, 'exec.run', { cmd: 'git', args: ['init'], timeout_ms: 10_000 });
}

async function ensureFile(client: BridgeRequestFacade, path: string, content: string): Promise<void> {
  const exists = await fileExists(client, path);
  if (exists) return;
  await writeManagedFile(client, path, content);
}

async function writeManagedFile(client: BridgeRequestFacade, path: string, content: string): Promise<void> {
  await safeRequest(client, 'fs.write', { path, content, encoding: 'utf8' });
}

async function fileExists(client: BridgeRequestFacade, path: string): Promise<boolean> {
  try {
    await client.request('fs.stat', { path });
    return true;
  } catch {
    return false;
  }
}

async function safeRequest(client: BridgeRequestFacade, op: string, data: unknown): Promise<void> {
  try {
    await client.request(op, data);
  } catch {
    // Workspace guide seeding should never block chat startup. The normal
    // bridge/tool errors still surface when the model explicitly uses tools.
  }
}

const ROOT_README = `# GatesAI Workspace

This workspace is the shared file area between you, GatesAI Chat, and the AI assistant.

Important folders:

- \`attachments/\` - files you upload through the chat composer. Treat these as source inputs.
- \`notes/\` - assistant scratch space, reusable scripts, and durable workspace notes.
- \`artifacts/\` - final outputs produced for you, including images, data files, reports, and exports.

For the assistant's environment guide, read:

- \`/workspace/notes/GatesAI-AI-Operating-Context.md\`

For the user-facing guide, open:

- \`/workspace/artifacts/reports/GatesAI-User-Guide.html\`

That guide documents how GatesAI Chat works from the model's point of view: available tools, workspace path rules, what the user can see, image-generation behavior, terminal/script limits, and artifact conventions.
`;

const ROOT_GITIGNORE = `.DS_Store
Thumbs.db
.gatesai/
tmp/
temp/
*.tmp
`;

const AI_OPERATING_CONTEXT = `# GatesAI AI Operating Context

This file is app-managed documentation for AI assistants running inside GatesAI Chat. Read it when you need facts about the application, tool environment, workspace layout, what the user sees, or how to produce durable outputs.

## Mental Model

GatesAI Chat is a local-first desktop chat app. The user sees a chat timeline, a left conversation sidebar, a composer, and menu sections for Agent, Models, Local, Workspace, Gallery, and Settings.

The assistant receives a system prompt, user messages, selected tool schemas, and relevant prior thread context. Tool results are metadata on assistant messages; they are not separate user-visible chat turns unless the app renders an artifact card.

The app has two main execution layers:

- Browser/Tauri UI: React, MobX stores, localStorage persistence, Markdown rendering, image cards, gallery, settings, and model selection.
- gatesai-bridge companion: a local sidecar process that owns the workspace, filesystem operations, terminal execution, attachment storage, and artifact writes.

## Workspace Path Contract

Use \`/workspace/...\` paths in tool arguments and in user-facing artifact references. These are model-facing paths, not absolute OS paths.

Terminal commands run from the real bridge workspace root. In scripts, use cwd-relative paths such as \`attachments/input.csv\`, \`notes/query_scripts/analyze.py\`, or \`artifacts/data/result.json\`. Do not treat \`/workspace\` as an absolute filesystem directory inside Python or Node.

Canonical folders:

- \`/workspace/attachments/\` - user uploads from the composer. Prefer read-only treatment.
- \`/workspace/notes/\` - assistant scratch space, reusable scripts, and notes.
- \`/workspace/notes/query_scripts/\` - preferred location for scripts used to analyze files.
- \`/workspace/artifacts/\` - durable user-facing outputs.
- \`/workspace/artifacts/images/api/\` - OpenRouter/hosted image-generation outputs.
- \`/workspace/artifacts/images/local/\` - local ComfyUI image-generation outputs.
- \`/workspace/artifacts/data/\` - reusable JSON, CSV, SQLite, and other structured data outputs.
- \`/workspace/artifacts/reports/\` - Markdown, HTML, PDF-like reports, summaries, and documents.
- \`/workspace/artifacts/exports/\` - finished deliverables that do not fit another category.

## What The User Sees

The user sees assistant prose in the chat timeline, rendered Markdown, user attachment chips/thumbnails, image job cards, generated image cards, and clickable \`/workspace/...\` paths. A workspace path in assistant Markdown can be opened through the OS when the bridge can resolve it.

The user does not see raw provider payloads, hidden system prompt text, or internal tool-loop messages except as summarized by the assistant or rendered as tool artifacts.

Image generation is intentionally asynchronous: the first assistant message should say the job is queued, and the image job card is the source of truth for progress, failure, success, and cancellation. Do not post a separate "Here it is" follow-up unless the image itself is visibly attached to that message.

## Core Tools

- \`workspace\` - inspect bridge state, platform, workspace root, path semantics, limits, and script workflow.
- \`fs\` - read, write, append, list, delete, move, copy, mkdir, stat, and search within the workspace path jail.
- \`inspect_file\` - preferred for CSV, JSON, text, and artifact-first discovery. Use \`workspace_profile\` before raw attachment reads.
- \`artifact\` - create and validate user-facing deliverables, especially HTML reports/apps/games under \`/workspace/artifacts\`.
- \`terminal\` - run allowlisted binaries with explicit argv from the workspace root. Shell syntax only works if you explicitly invoke an allowlisted shell.
- \`python_inline\` - quick Python snippets for small computations.
- \`query_script\` - templates and workflow for repeatable scripts under \`notes/query_scripts\` with outputs under \`artifacts\`.
- \`sqlite_query\` - read-only SQL queries over workspace-relative SQLite databases.
- \`git\` - repo operations when the bridge and allowlist permit them.
- \`describe_image\` - local vision helper for workspace images.
- \`image_generate\` - queue image jobs using the configured backend.
- \`memory\`, \`notes\`, \`thread\`, and \`time\` - conversation memory, app notes, thread operations, and current time.

Tool availability can be turn-dependent. If a tool is absent, answer with the available context or ask the user to retry with the needed capability enabled.

## File And Data Workflow

For data questions, work artifact-first:

1. Call \`inspect_file({ action: "workspace_profile" })\` to see artifacts, attachments, notes, and scripts.
2. Reuse existing processed artifacts if they answer the question.
3. Use \`inspect_file\` profile, preview, search, extract, or aggregate before raw \`fs.read\` on large files.
4. For substantial transforms, write a reusable script under \`/workspace/notes/query_scripts/\`.
5. Run it from the workspace root with terminal.
6. Write reusable outputs under \`/workspace/artifacts/data/\` or reports under \`/workspace/artifacts/reports/\`.
7. Validate before claiming success: counts, schema checks, min/max/ranges, sample rows, or spot checks.

Keep large data in files. Do not paste huge datasets into chat unless the user explicitly wants that.

## Image Generation

Image generation is routed through the configured backend:

- OpenRouter image generation saves final files under \`/workspace/artifacts/images/api/\`.
- Local ComfyUI generation saves final files under \`/workspace/artifacts/images/local/\`.

Treat an \`image_generate\` tool result as queued, not completed. The image job card is the source of truth for pending/running/success/failure/cancellation. If a render fails or is lost, explain the failure state and suggest a retry or settings check without inventing a completed-image message.

## Limitations And Cautions

- The bridge enforces a workspace path jail. Tools cannot read arbitrary OS paths through \`fs\`.
- Bridge offline means workspace tools, file access, terminal execution, and image artifact persistence may be unavailable.
- Terminal output is captured and may be truncated by bridge/tool limits.
- The terminal tool passes command plus argv directly; pipes, redirects, glob expansion, and heredocs are shell features, not generic terminal features.
- Local runtimes such as Ollama and ComfyUI may be offline or misconfigured.
- Provider costs are tracked when providers return usage data; absence of a cost value is not proof a call was free.
- The assistant should not claim a file, image, build, test, or analysis succeeded until the relevant tool result or validation confirms it.

## Response Style For Workspace Work

Be concise and concrete. Mention created files using \`/workspace/...\` paths. For generated artifacts, say what was created, where it is, and what validation was performed. If a tool fails, report the reason and the next useful action.
`;

export const DEFAULT_WORKSPACE_GUIDE_PATHS = {
  rootReadme: ROOT_README_PATH,
  aiGuide: AI_GUIDE_PATH,
  rootGitignore: ROOT_GITIGNORE_PATH,
} as const;
