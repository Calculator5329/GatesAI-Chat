// Public Node/headless entry for the complete GatesAI store graph.
// Called by scripts and CLI adapters; depends on stores/core without React or DOM globals.
// Invariant: messages use ChatStore's normal turn pipeline and every boot is disposable.
import { autorun, runInAction } from 'mobx';
import { messageText } from './core/messageParts';
import type { AssistantMessage, Model } from './core/types';
import { RootStore } from './stores/RootStore';

export interface HeadlessOllamaOptions {
  baseUrl?: string;
  apiKey?: string;
}

export interface HeadlessSendOptions {
  threadId?: string;
  /** Registry id (`ollama-llama3.2`) or Ollama tag (`llama3.2`). */
  model?: string;
  onText?: (delta: string) => void;
  signal?: AbortSignal;
}

export interface HeadlessReply {
  threadId: string;
  messageId: string;
  text: string;
}

export interface HeadlessCore {
  readonly store: RootStore;
  connectOllama(options?: HeadlessOllamaOptions): Promise<Model[]>;
  sendMessage(text: string, options?: HeadlessSendOptions): Promise<HeadlessReply>;
  dispose(): void;
}

/** Boot the same RootStore graph used by the app, without React, a DOM, or browser lifecycle hooks. */
export function bootHeadlessCore(): HeadlessCore {
  const store = new RootStore({ runtime: 'headless' });
  let disposed = false;
  store.boot();

  return {
    store,
    async connectOllama(options = {}) {
      assertActive();
      if (options.baseUrl !== undefined) store.localRuntime.setBaseUrl('ollama', options.baseUrl);
      if (options.apiKey !== undefined) store.ollama.setKey(options.apiKey);

      const probe = await store.localRuntime.testConnection('ollama');
      if (!probe.ok) throw new Error(`Unable to connect to Ollama: ${probe.error}`);

      // Populate the catalog before marking the provider online. This avoids
      // RootStore's online autorun launching a duplicate catalog request.
      await store.ollama.refresh();
      if (store.ollama.lastError) throw new Error(store.ollama.lastError);
      runInAction(() => { store.localRuntime.runtimes.ollama.status = 'online'; });
      return store.ollama.catalog;
    },
    async sendMessage(text, options = {}) {
      assertActive();
      const prompt = text.trim();
      if (!prompt) throw new Error('Message text is required.');
      const threadId = selectThread(store, options.threadId);
      const model = resolveOllamaModel(store, options.model);
      store.chat.setThreadModel(threadId, model.id);
      const beforeIds = new Set(store.chat.activeThread?.messages.map(message => message.id) ?? []);

      return await new Promise<HeadlessReply>((resolve, reject) => {
        let lastText = '';
        let assistantSeen = false;
        let settled = false;
        let stop = () => {};
        const finish = (callback: () => void) => {
          if (settled) return;
          settled = true;
          stop();
          options.signal?.removeEventListener('abort', abort);
          callback();
        };
        const abort = () => {
          store.chat.stopStreaming();
          const error = new Error('Headless message was cancelled.');
          error.name = 'AbortError';
          finish(() => reject(error));
        };

        stop = autorun(() => {
          const thread = store.chat.threads.find(candidate => candidate.id === threadId);
          const assistant = thread?.messages.find(
            (message): message is AssistantMessage => message.role === 'assistant' && !beforeIds.has(message.id),
          );
          const currentText = assistant ? messageText(assistant) : '';
          if (assistant) assistantSeen = true;
          if (currentText.length > lastText.length) options.onText?.(currentText.slice(lastText.length));
          lastText = currentText;

          if (assistantSeen && !store.chat.isThreadStreaming(threadId) && assistant) {
            finish(() => resolve({ threadId, messageId: assistant.id, text: currentText }));
          }
        });

        if (options.signal?.aborted) {
          abort();
          return;
        }
        options.signal?.addEventListener('abort', abort, { once: true });
        store.chat.sendMessage(prompt);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      store.dispose();
    },
  };

  function assertActive(): void {
    if (disposed) throw new Error('Headless core has been disposed.');
  }
}

function selectThread(store: RootStore, requestedId: string | undefined): string {
  if (requestedId) {
    if (!store.chat.selectThread(requestedId)) throw new Error(`Unknown thread: ${requestedId}`);
    return requestedId;
  }
  return store.chat.activeThreadId ?? store.chat.createThread();
}

function resolveOllamaModel(store: RootStore, requested: string | undefined): Model {
  const catalog = store.registry.all.filter(model => model.providerId === 'ollama');
  const model = requested
    ? store.registry.findById(requested) ?? catalog.find(candidate => candidate.providerModelId === requested)
    : catalog[0];
  if (!model || model.providerId !== 'ollama') {
    throw new Error(requested
      ? `Ollama model not found: ${requested}`
      : 'No Ollama chat models are available. Connect Ollama before sending.');
  }
  if (!store.providers.isConnected('ollama')) throw new Error('Ollama is not connected.');
  return model;
}

export interface HeadlessCliIo {
  stdout: { write(text: string): unknown };
  stderr: { write(text: string): unknown };
}

/** Scriptable CLI entry. Returns a process-style exit code and streams the reply to stdout. */
export async function runHeadlessCli(args: readonly string[], io: HeadlessCliIo): Promise<number> {
  let parsed: ParsedCliArgs;
  try {
    parsed = parseCliArgs(args);
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  if (parsed.help) {
    io.stdout.write('Usage: npx vite-node src/headless-cli.ts [--base-url URL] [--api-key KEY] [--model TAG] MESSAGE\n');
    return 0;
  }
  if (!parsed.message) {
    io.stderr.write('A message is required. Use --help for usage.\n');
    return 2;
  }

  const core = bootHeadlessCore();
  try {
    await core.connectOllama({ baseUrl: parsed.baseUrl, apiKey: parsed.apiKey });
    await core.sendMessage(parsed.message, {
      model: parsed.model,
      onText: delta => { io.stdout.write(delta); },
    });
    io.stdout.write('\n');
    return 0;
  } catch (error) {
    io.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  } finally {
    core.dispose();
  }
}

interface ParsedCliArgs {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  message: string;
  help: boolean;
}

function parseCliArgs(args: readonly string[]): ParsedCliArgs {
  const parsed: ParsedCliArgs = { message: '', help: false };
  const message: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') { parsed.help = true; continue; }
    if (arg === '--base-url' || arg === '--api-key' || arg === '--model') {
      const value = args[index + 1];
      if (!value) throw new Error(`Missing value for ${arg}.`);
      index += 1;
      if (arg === '--base-url') parsed.baseUrl = value;
      else if (arg === '--api-key') parsed.apiKey = value;
      else parsed.model = value;
      continue;
    }
    message.push(arg);
  }
  parsed.message = message.join(' ').trim();
  return parsed;
}
