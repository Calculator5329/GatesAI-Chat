// Defines the fixed, local-only welcome conversation and its first-run seed
// policy. Called by RootStore during startup; depends only on core message
// contracts so the tour never needs a provider or runtime tool execution.
import type { Thread } from './core/types';

export const WELCOME_TOUR_THREAD_ID = 'welcome-tour-v1';

const COLLAPSED_WORKSPACE_OUTPUT = [
  'Workspace profile',
  'artifacts/',
  '  reports/',
  '    project-brief.html',
  '    research-notes.md',
  '  data/',
  '    customer-summary.json',
  'attachments/',
  '  kickoff-notes.pdf',
  'notes/',
  '  query_scripts/',
  ...Array.from({ length: 34 }, (_, index) => `  sample-${String(index + 1).padStart(2, '0')}.txt`),
].join('\n');

/** Build the read-only, pre-authored thread with ordinary persisted messages. */
export function createWelcomeTourThread({ modelId, now }: { modelId: string; now: number }): Thread {
  return {
    id: WELCOME_TOUR_THREAD_ID,
    title: 'Welcome tour',
    subtitle: 'A quick look around GatesAI Chat',
    createdAt: now,
    updatedAt: now,
    pinned: true,
    readOnly: true,
    modelId,
    messages: [
      {
        id: 'welcome-tour-intro',
        role: 'assistant',
        content: 'Welcome to GatesAI Chat. This short, read-only tour uses the same message surfaces as a normal conversation so you can see how tools, workspace artifacts, and images appear.',
        createdAt: now,
        model: modelId,
      },
      {
        id: 'welcome-tour-tool-prompt',
        role: 'user',
        content: 'What is already in my workspace?',
        createdAt: now + 1_000,
      },
      {
        id: 'welcome-tour-tool',
        role: 'assistant',
        content: 'I checked the workspace first. Tool activity stays with the reply, and longer output is collapsed until you want to inspect it.',
        createdAt: now + 2_000,
        model: modelId,
        toolCalls: [{
          id: 'welcome-tour-fs-list',
          name: 'fs',
          arguments: { action: 'list', path: '/workspace' },
        }],
        toolResults: [{
          toolCallId: 'welcome-tour-fs-list',
          toolName: 'fs',
          content: COLLAPSED_WORKSPACE_OUTPUT,
          summary: '42 workspace entries',
          ok: true,
          ranAt: now + 2_500,
        }],
      },
      {
        id: 'welcome-tour-artifact',
        role: 'assistant',
        content: 'Artifacts are durable deliverables such as reports, apps, and datasets. This is a static tour representation of an HTML artifact—no file was created for this bundled example.',
        createdAt: now + 3_000,
        model: modelId,
        toolCalls: [{
          id: 'welcome-tour-artifact-create',
          name: 'artifact',
          arguments: {
            action: 'create_html_artifact',
            path: '/workspace/artifacts/reports/project-brief.html',
            content: '<!doctype html><title>Project brief</title><main>Example artifact</main>',
          },
        }],
        toolResults: [{
          toolCallId: 'welcome-tour-artifact-create',
          toolName: 'artifact',
          content: 'Created and validated HTML artifact at /workspace/artifacts/reports/project-brief.html.\n\nStatic tour example only; no workspace file was written.',
          summary: 'Example HTML artifact',
          ok: true,
          ranAt: now + 3_500,
        }],
      },
      {
        id: 'welcome-tour-image-prompt',
        role: 'user',
        content: 'Here is an image attachment.',
        createdAt: now + 4_000,
        attachments: [{
          id: 'welcome-tour-image-placeholder',
          path: '/workspace/attachments/welcome-image-placeholder.png',
          name: 'welcome-image-placeholder.png',
          mime: 'image/png',
          size: 0,
        }],
      },
      {
        id: 'welcome-tour-image',
        role: 'assistant',
        content: 'Image attachments appear directly on the message. This one is a static placeholder, so it does not require a bundled image file; your pasted, dropped, or attached images render here normally.',
        createdAt: now + 5_000,
        model: modelId,
      },
      {
        id: 'welcome-tour-close',
        role: 'assistant',
        content: 'When you are ready, start a new conversation. Use ↑ in the composer to recall a previous prompt, and paste or drag files and images straight into the window to attach them.',
        createdAt: now + 6_000,
        model: modelId,
      },
    ],
  };
}

/** Small cross-store seam: only a true first launch may write the tour once. */
export function seedWelcomeTourOnFirstRun(
  chat: { seedWelcomeTour(): boolean },
  whatsNew: { isFirstRun: boolean; tourThreadSeeded: boolean; markTourThreadSeeded(): void },
): boolean {
  if (!whatsNew.isFirstRun || whatsNew.tourThreadSeeded) return false;
  const seeded = chat.seedWelcomeTour();
  if (seeded) whatsNew.markTourThreadSeeded();
  return seeded;
}
