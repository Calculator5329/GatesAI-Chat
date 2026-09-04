// The scenario catalog. Each entry is a starting state a journey can name in
// its context path (`/?scenario=desktop-ready#/`). Keep this list in step with
// docs/handbook/journeys.md, which explains each one in plain language.
import { runInAction } from 'mobx';
import { VISIBLE_IMAGE_PNG_BASE64 } from './mocks/bridge';
import {
  buildSeed,
  defaultRagSettings,
  LOCAL_REPLY,
  localOnlyThreads,
  readyImageJobs,
  readyProfile,
  readyThreads,
  STREAMED_REPLY,
  workspaceFiles,
} from './seeds';
import type { AfterBootStore, ScenarioDefinition } from './types';

const LOCAL_MODELS = ['qwen2.5:7b', 'llama3.2:3b', 'nomic-embed-text'];

/** Outside Tauri the runtime status command does not exist; state it, then load the mocked tag list. */
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
      openrouter: { turns: [{ kind: 'text', text: STREAMED_REPLY }] },
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
];

export function findScenario(name: string): ScenarioDefinition | undefined {
  return SCENARIOS.find(scenario => scenario.name === name);
}
