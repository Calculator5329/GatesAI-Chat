// The scenario catalog. Each entry is a starting state a journey can name in
// its context path (`/?scenario=desktop-ready#/`). Keep this list in step with
// docs/handbook/journeys.md, which explains each one in plain language.
import { runInAction } from 'mobx';
import { VISIBLE_IMAGE_PNG_BASE64 } from './mocks/bridge';
import {
  auroraThreads,
  buildSeed,
  coverageFiles,
  coverageImageJobs,
  coverageLibrary,
  coverageThreads,
  defaultRagSettings,
  emptyLocalThread,
  LOCAL_PROVIDER_MODEL_ID,
  LOCAL_REPLY,
  localImageThread,
  localOnlyThreads,
  readyImageJobs,
  readyProfile,
  readyThreads,
  STREAMED_REPLY,
  workspaceFiles,
} from './seeds';
import type { AfterBootStore, ScenarioDefinition } from './types';

const LOCAL_MODELS = ['qwen2.5:7b', 'llama3.2:3b', 'nomic-embed-text'];
/** Chat models only: semantic recall reports its embedding model missing. */
const LOCAL_CHAT_MODELS = ['qwen2.5:7b', 'llama3.2:3b'];
const SLOW_PULL = { frames: 12, delayMs: 400 };

/** Outside Tauri the runtime status command does not exist; state it, then load the mocked tag list. */
async function waitForLeader(chat: { persistenceLeaderState: string | null }, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (chat.persistenceLeaderState !== 'leader' && chat.persistenceLeaderState !== 'fallback' && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}

async function ollamaOnline(store: AfterBootStore): Promise<void> {
  const runtime = store.localRuntime;
  if (runtime) {
    runInAction(() => {
      runtime.runtimes.ollama.status = 'online';
      runtime.runtimes.ollama.installPath = '/usr/local/bin/ollama';
      runtime.runtimes.ollama.lastError = undefined;
      runtime.runtimes.ollama.lastErrorKind = undefined;
      runtime.runtimes.comfyui.status = 'stopped';
    });
  }
  await store.ollama?.refresh();
}

/** Ollama installed but not running: the empty state offers to start it. */
async function ollamaInstalledStopped(store: AfterBootStore): Promise<void> {
  const runtime = store.localRuntime;
  if (!runtime) return;
  runInAction(() => {
    runtime.runtimes.ollama.status = 'stopped';
    runtime.runtimes.ollama.installPath = '/usr/local/bin/ollama';
    runtime.runtimes.comfyui.status = 'stopped';
  });
}

const MOCK_CATALOG = [
  { id: 'openai/gpt-5.5', name: 'OpenAI: GPT-5.5', context_length: 400000, pricing: { prompt: '0.00000125', completion: '0.00001' }, architecture: { output_modalities: ['text'] } },
  { id: 'google/gemini-3-flash', name: 'Google: Gemini 3 Flash', context_length: 1000000, pricing: { prompt: '0.0000003', completion: '0.0000025' }, architecture: { output_modalities: ['text'] } },
];

const ONLINE_NETWORK = {
  openrouter: { turns: [{ kind: 'text' as const, text: STREAMED_REPLY }], catalog: MOCK_CATALOG },
  ollama: { models: LOCAL_MODELS, reply: LOCAL_REPLY },
  bridge: { files: workspaceFiles() },
};

function readySeed(overrides: Partial<Parameters<typeof buildSeed>[0]> = {}) {
  const now = Date.now();
  return buildSeed({
    readyProvider: true,
    onboardingDismissed: true,
    threads: readyThreads(now),
    activeThreadId: 'active',
    profile: readyProfile(),
    imageJobs: readyImageJobs(now),
    ragSettings: defaultRagSettings(),
    ...overrides,
  });
}

export const SCENARIOS: ScenarioDefinition[] = [
  {
    name: 'first-run',
    title: 'First run, nothing configured',
    description: 'No provider key, onboarding still showing, no threads, version already acknowledged so no welcome tour. OpenRouter answers once a key is added; Ollama and the bridge are unreachable.',
    seed: () => buildSeed({ readyProvider: false, onboardingDismissed: false }),
    network: {
      openrouter: { turns: [{ kind: 'text', text: 'Welcome. Your first cloud reply arrived through the mocked OpenRouter stream.' }] },
      ollama: 'offline',
      bridge: 'offline',
    },
  },
  {
    name: 'desktop-ready',
    title: 'Desktop, everything online',
    description: 'OpenRouter key present, four seeded threads, profile, an image job in history, bridge online with a workspace, Ollama online with three models.',
    seed: () => readySeed(),
    network: {
      openrouter: { turns: [{ kind: 'text', text: STREAMED_REPLY }], catalog: MOCK_CATALOG },
      ollama: { models: LOCAL_MODELS, reply: LOCAL_REPLY },
      bridge: { files: workspaceFiles() },
      image: { base64: VISIBLE_IMAGE_PNG_BASE64, mime: 'image/png' },
    },
    afterBoot: ollamaOnline,
  },
  {
    name: 'slow-stream',
    title: 'Desktop, slow streamed reply',
    description: 'Same as desktop-ready, but the assistant reply streams one small delta every 350 ms so the stop control stays visible.',
    seed: () => readySeed(),
    network: {
      openrouter: {
        chunkDelayMs: 350,
        chunkSize: 12,
        turns: [{ kind: 'text', text: 'This reply arrives slowly, a dozen characters at a time, so a journey can interrupt it before the last sentence lands. '.repeat(6) }],
      },
      ollama: { models: LOCAL_MODELS, reply: LOCAL_REPLY },
      bridge: { files: workspaceFiles() },
    },
    afterBoot: ollamaOnline,
  },
  {
    name: 'tool-turn',
    title: 'Desktop, assistant calls the time tool',
    description: 'The first reply is a tool call to `time`; the follow-up reply reads the result back, so the activity row and the final answer both render.',
    seed: () => readySeed(),
    network: {
      openrouter: {
        turns: [
          { kind: 'tool_call', name: 'time', args: {}, id: 'call_time_1' },
          { kind: 'text', text: 'I checked the clock with the time tool. The timestamp above is the moment this turn ran.' },
        ],
      },
      ollama: { models: LOCAL_MODELS, reply: LOCAL_REPLY },
      bridge: { files: workspaceFiles() },
    },
    afterBoot: ollamaOnline,
  },
  {
    name: 'web-search',
    title: 'Desktop, web search grounded reply',
    description: 'Brave key present. The first reply calls web_search, Brave returns two mocked sources, and the follow-up reply cites them.',
    seed: () => readySeed({ braveKey: true }),
    network: {
      openrouter: {
        turns: [
          { kind: 'tool_call', name: 'web_search', args: { queries: ['agent handles journey catalog'] }, id: 'call_search_1' },
          { kind: 'text', text: 'Two sources answered. The journey catalog is a manifest of named paths through the product, and every path is replayed against mocked providers before it counts as covered.' },
        ],
      },
      ollama: { models: LOCAL_MODELS, reply: LOCAL_REPLY },
      bridge: { files: workspaceFiles() },
      brave: {
        results: [
          { title: 'agent-handles: journeys', url: 'https://example.test/agent-handles/journeys', text: 'A journey is a named, replayable path through a product, expressed as steps over stable control identities.' },
          { title: 'Mocked providers for UI tests', url: 'https://example.test/mocked-providers', text: 'Deterministic provider mocks let the real UI run without keys or sidecars.' },
        ],
      },
    },
    afterBoot: ollamaOnline,
  },
  {
    name: 'image-job',
    title: 'Desktop, assistant generates an image',
    description: 'The first reply calls image_generate; OpenRouter returns a small SVG as a data URL, the bridge stores it, and the job card renders the result.',
    seed: () => readySeed(),
    network: {
      openrouter: {
        turns: [
          { kind: 'tool_call', name: 'image_generate', args: { prompt: 'A wax seal with the letter G pressed into deep green paper', count: 1, filename: 'wax-seal-g' }, id: 'call_image_1' },
          { kind: 'text', text: 'The render is queued. The card above updates as the job finishes.' },
        ],
      },
      ollama: { models: LOCAL_MODELS, reply: LOCAL_REPLY },
      bridge: { files: workspaceFiles() },
      image: { base64: VISIBLE_IMAGE_PNG_BASE64, mime: 'image/png', costUsd: 0.04 },
    },
    afterBoot: ollamaOnline,
  },
  {
    name: 'local-ollama',
    title: 'Local only, Ollama online',
    description: 'No cloud key. Ollama answers with three models and the active thread is pinned to qwen2.5:7b, so a turn stays on the machine.',
    seed: () => {
      const now = Date.now();
      return buildSeed({
        readyProvider: false,
        onboardingDismissed: true,
        threads: localOnlyThreads(now),
        activeThreadId: 'local-active',
        profile: { bio: '- User is auditing local-only Ollama workflows.', defaultSystemPrompt: 'Prefer concise local-first answers.' },
        ragSettings: defaultRagSettings(),
      });
    },
    network: {
      openrouter: 'offline',
      ollama: { models: LOCAL_MODELS, reply: LOCAL_REPLY },
      bridge: { files: workspaceFiles() },
    },
    afterBoot: ollamaOnline,
  },
  {
    name: 'bridge-offline',
    title: 'Desktop, bridge and Ollama unreachable',
    description: 'OpenRouter works, but the bridge health poll and its WebSocket fail and Ollama refuses connections, so workspace features degrade.',
    seed: () => readySeed({ imageJobs: undefined }),
    network: {
      openrouter: { turns: [{ kind: 'text', text: STREAMED_REPLY }] },
      ollama: 'offline',
      bridge: 'offline',
    },
  },
  {
    name: 'provider-error',
    title: 'Desktop, OpenRouter returns an error',
    description: 'Every chat request fails with HTTP 500, so the error banner and its dismiss control are reachable.',
    seed: () => readySeed(),
    network: {
      openrouter: { turns: [{ kind: 'error', status: 500, message: 'Upstream model provider is unavailable (mocked).' }] },
      ollama: { models: LOCAL_MODELS, reply: LOCAL_REPLY },
      bridge: { files: workspaceFiles() },
    },
    afterBoot: ollamaOnline,
  },
  {
    name: 'whats-new',
    title: 'Desktop, upgraded since last visit',
    description: 'desktop-ready, but the last acknowledged version is older than the running one, so the whats-new panel opens on boot.',
    seed: () => readySeed({ lastSeenVersion: '4.6.1' }),
    network: {
      openrouter: { turns: [{ kind: 'text', text: STREAMED_REPLY }] },
      ollama: { models: LOCAL_MODELS, reply: LOCAL_REPLY },
      bridge: { files: workspaceFiles() },
    },
    afterBoot: ollamaOnline,
  },
  {
    name: 'light-theme',
    title: 'Desktop, light theme preselected',
    description: 'desktop-ready with the paper light theme already chosen, for journeys that must start from the light palette.',
    seed: () => readySeed({ theme: 'light' }),
    network: {
      openrouter: { turns: [{ kind: 'text', text: STREAMED_REPLY }] },
      ollama: { models: LOCAL_MODELS, reply: LOCAL_REPLY },
      bridge: { files: workspaceFiles() },
    },
    afterBoot: ollamaOnline,
  },
  {
    name: 'rich-transcript',
    title: 'Desktop, transcript surfaces of every kind',
    description: 'desktop-ready plus seven more threads: an HTML artifact reply, an 84-message conversation, a message with attachments, a four-turn exchange, grouped terminal activity, memory sources of every kind, and image jobs done, failed and cancelled. One approved library source. Image replies take 2.5 s so a retried job stays visibly running.',
    seed: () => {
      const now = Date.now();
      return readySeed({
        threads: [...coverageThreads(now), ...readyThreads(now)],
        activeThreadId: 'html',
        imageJobs: [...readyImageJobs(now), ...coverageImageJobs(now)],
        library: coverageLibrary(now),
      });
    },
    network: {
      ...ONLINE_NETWORK,
      bridge: { files: [...workspaceFiles(), ...coverageFiles()] },
      image: { base64: VISIBLE_IMAGE_PNG_BASE64, mime: 'image/png', costUsd: 0.04, delayMs: 2500 },
    },
    afterBoot: ollamaOnline,
  },
  {
    name: 'aurora-pack',
    title: 'Desktop, Aurora interface pack',
    description: 'desktop-ready with the Aurora pack selected and a reply that carries a diff artifact past the fold, a finished image job, a source footer and a follow-up offer.',
    seed: () => {
      const now = Date.now();
      return readySeed({ uiPack: 'aurora', threads: [...auroraThreads(now), ...readyThreads(now)], activeThreadId: 'aurora-active' });
    },
    network: ONLINE_NETWORK,
    afterBoot: ollamaOnline,
  },
  {
    name: 'prompt-cards',
    title: 'Desktop, assistant is asking three questions',
    description: 'desktop-ready with three pending assistant prompts on the active thread: an approval with two options, a recommendation that allows a free-text answer, and one to skip.',
    seed: () => readySeed(),
    network: ONLINE_NETWORK,
    afterBoot: async (store) => {
      await ollamaOnline(store);
      const prompts = store.prompts;
      if (!prompts) return;
      const base = { threadId: 'active', createdAt: Date.now(), grounds: ['The workspace has an untracked file at /workspace/notes/draft.md.'] };
      const approval = { ...base, id: 'prompt-approve', kind: 'approval', question: 'May I delete the draft note?', context: 'The file would be removed from the workspace.', options: [{ id: 'yes', label: 'Delete it', detail: 'The note is a duplicate.' }, { id: 'no', label: 'Keep it' }], allowFreeText: false };
      const recommendation = { ...base, id: 'prompt-recommend', kind: 'recommendation', question: 'Which title should the note get?', options: [{ id: 'audit', label: 'Audit plan' }, { id: 'review', label: 'Review notes' }], allowFreeText: true };
      const skippable = { ...base, id: 'prompt-skip', kind: 'recommendation', question: 'Should I also pin the conversation?', options: [{ id: 'pin', label: 'Pin it' }], allowFreeText: false };
      runInAction(() => { prompts.pending.push(approval, recommendation, skippable); });
    },
  },
  {
    name: 'update-available',
    title: 'Desktop, an update is available',
    description: 'desktop-ready with the updater reporting version 9.9.9 available, so the update pill and its dismiss control render. Installing outside the desktop shell reports an error, which the pill also shows.',
    seed: () => readySeed(),
    network: ONLINE_NETWORK,
    afterBoot: async (store) => {
      await ollamaOnline(store);
      const updates = store.updates;
      if (!updates) return;
      runInAction(() => {
        updates.phase = 'available';
        updates.version = '9.9.9';
        updates.notes = 'Mocked release notes.';
      });
    },
  },
  {
    name: 'attachments-drafted',
    title: 'Desktop, two files already attached to the draft',
    description: 'desktop-ready with a PNG and a text file staged in the composer tray, and a persistence-conflict notice above the draft.',
    seed: () => readySeed(),
    network: { ...ONLINE_NETWORK, bridge: { files: [...workspaceFiles(), ...coverageFiles()] } },
    afterBoot: async (store) => {
      await ollamaOnline(store);
      store.ui?.addAttachment({ id: 'draft-diagram', filename: 'diagram.png', path: '/workspace/attachments/diagram.png', size: 345, mime: 'image/png' });
      store.ui?.addAttachment({ id: 'draft-notes', filename: 'notes.txt', path: '/workspace/attachments/notes.txt', size: 44, mime: 'text/plain' });
      const chat = store.chat;
      if (chat) {
        // Winning the Web Locks election reloads from storage and clears the
        // notice, so stage it only once this tab has become the leader.
        await waitForLeader(chat);
        runInAction(() => { chat.persistenceConflict = 'Another window saved newer conversations (mocked).'; });
      }
    },
  },
  {
    name: 'first-run-local-ready',
    title: 'First run, Ollama online with models',
    description: 'No provider key and onboarding showing, but Ollama answers with three models, so the local card offers to continue with one. The menu coach mark has not been seen.',
    seed: () => buildSeed({ readyProvider: false, onboardingDismissed: false, menuHintSeen: false }),
    network: { openrouter: 'offline', ollama: { models: LOCAL_MODELS, reply: LOCAL_REPLY }, bridge: 'offline' },
    afterBoot: ollamaOnline,
  },
  {
    name: 'first-run-local-empty',
    title: 'First run, Ollama online without models',
    description: 'Onboarding showing and Ollama online with no models pulled, so the local card offers a starter pull; the mocked pull streams twelve progress frames.',
    seed: () => buildSeed({ readyProvider: false, onboardingDismissed: false }),
    network: { openrouter: 'offline', ollama: { models: [], reply: LOCAL_REPLY, pull: SLOW_PULL }, bridge: 'offline' },
    afterBoot: ollamaOnline,
  },
  {
    name: 'first-run-local-installed',
    title: 'First run, Ollama installed but stopped',
    description: 'Onboarding showing, Ollama installed at a known path but not running, so the local card offers to start it and check again.',
    seed: () => buildSeed({ readyProvider: false, onboardingDismissed: false }),
    network: { openrouter: 'offline', ollama: 'offline', bridge: 'offline' },
    afterBoot: ollamaInstalledStopped,
  },
  {
    name: 'local-no-embed',
    title: 'Local only, embedding model missing',
    description: 'Ollama online with chat models but no nomic-embed-text, and an empty conversation pinned to a local model, so the semantic-memory nudge and the Install button in Agent settings render. The mocked pull streams slowly enough to cancel.',
    seed: () => {
      const now = Date.now();
      return buildSeed({
        readyProvider: false,
        onboardingDismissed: true,
        threads: [emptyLocalThread(now), ...localOnlyThreads(now)],
        activeThreadId: 'local-empty',
        ragSettings: defaultRagSettings(),
      });
    },
    network: { openrouter: 'offline', ollama: { models: LOCAL_CHAT_MODELS, reply: LOCAL_REPLY, pull: SLOW_PULL }, bridge: { files: workspaceFiles() } },
    afterBoot: ollamaOnline,
  },
  {
    name: 'local-ollama-offline',
    title: 'Local only, Ollama unreachable',
    description: 'The active conversation is pinned to a local model but Ollama refuses connections, so the composer shows the local-settings banner.',
    seed: () => {
      const now = Date.now();
      return buildSeed({ readyProvider: false, onboardingDismissed: true, threads: localOnlyThreads(now), activeThreadId: 'local-active', ollamaCatalog: [LOCAL_PROVIDER_MODEL_ID] });
    },
    network: { openrouter: 'offline', ollama: 'offline', bridge: { files: workspaceFiles() } },
  },
  {
    name: 'local-image-model',
    title: 'Desktop, direct image model with ComfyUI stopped',
    description: 'The active conversation is pinned to the direct local image model while ComfyUI is stopped, so the composer shows the local-image-settings banner.',
    seed: () => {
      const now = Date.now();
      return readySeed({ threads: [localImageThread(now), ...readyThreads(now)], activeThreadId: 'local-image' });
    },
    network: ONLINE_NETWORK,
    afterBoot: ollamaOnline,
  },
  {
    name: 'desktop-bare',
    title: 'Desktop, one conversation and nothing queued',
    description: 'OpenRouter key present, a single plain thread, no image jobs and no background tasks, so the task center is empty.',
    seed: () => {
      const now = Date.now();
      return readySeed({ threads: readyThreads(now).filter(thread => thread.id === 'usage'), activeThreadId: 'usage', imageJobs: undefined });
    },
    network: ONLINE_NETWORK,
    afterBoot: ollamaOnline,
  },
];

export function findScenario(name: string): ScenarioDefinition | undefined {
  return SCENARIOS.find(scenario => scenario.name === name);
}
