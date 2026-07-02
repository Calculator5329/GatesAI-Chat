import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSecretStorage,
  deleteSecret,
  DESKTOP_SECRET_MIGRATION_MARKER,
  getSecret,
  migrateDesktopSecretsFromLocalStorage,
  SECRET_NAMES,
  setSecret,
} from '../../src/services/secretStorage';
import { clearAppStorage } from '../helpers/storage';

type TestInvoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;

describe('secretStorage', () => {
  beforeEach(() => clearAppStorage());
  afterEach(() => {
    clearAppStorage();
    vi.restoreAllMocks();
  });

  it('uses the localStorage backend by default in jsdom and preserves the OpenRouter slot', async () => {
    await setSecret(SECRET_NAMES.openrouterApiKey, 'sk-web');

    expect(await getSecret(SECRET_NAMES.openrouterApiKey)).toBe('sk-web');
    expect(JSON.parse(localStorage.getItem('gatesai.providers.v1') ?? '{}')).toEqual({
      openrouter: { apiKey: 'sk-web' },
    });

    await deleteSecret(SECRET_NAMES.openrouterApiKey);

    expect(await getSecret(SECRET_NAMES.openrouterApiKey)).toBeNull();
    expect(localStorage.getItem('gatesai.providers.v1')).toBeNull();
  });

  it('round-trips set/get/delete through mocked Tauri invoke', async () => {
    const secrets = new Map<string, string>();
    const tauriInvoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      const name = args?.name as string;
      if (cmd === 'secret_set') {
        secrets.set(name, args?.value as string);
        return undefined;
      }
      if (cmd === 'secret_get') return secrets.get(name) ?? null;
      if (cmd === 'secret_delete') {
        secrets.delete(name);
        return undefined;
      }
      throw new Error(`unexpected command ${cmd}`);
    }) as TestInvoke;
    const storage = createSecretStorage({ useTauri: true, tauriInvoke });

    await storage.setSecret(SECRET_NAMES.braveApiKey, 'brv-test');
    expect(await storage.getSecret(SECRET_NAMES.braveApiKey)).toBe('brv-test');
    await storage.deleteSecret(SECRET_NAMES.braveApiKey);

    expect(await storage.getSecret(SECRET_NAMES.braveApiKey)).toBeNull();
    expect(tauriInvoke).toHaveBeenCalledWith('secret_set', {
      name: SECRET_NAMES.braveApiKey,
      value: 'brv-test',
    });
  });

  it('selects the Tauri backend only when requested', async () => {
    const tauriInvoke = vi.fn(async () => undefined) as TestInvoke;

    await createSecretStorage({ useTauri: true, tauriInvoke }).setSecret(SECRET_NAMES.ollamaApiKey, 'ol-key');
    expect(tauriInvoke).toHaveBeenCalledWith('secret_set', {
      name: SECRET_NAMES.ollamaApiKey,
      value: 'ol-key',
    });
    expect(localStorage.getItem('gatesai.ollama.v1')).toBeNull();

    await createSecretStorage({ useTauri: false }).setSecret(SECRET_NAMES.ollamaApiKey, 'web-ol-key');
    expect(JSON.parse(localStorage.getItem('gatesai.ollama.v1') ?? '{}')).toEqual({
      apiKey: 'web-ol-key',
    });
  });

  it('migrates known desktop keys after verified keychain read-back', async () => {
    localStorage.setItem('gatesai.providers.v1', JSON.stringify({
      openrouter: { apiKey: 'sk-or', baseUrl: 'https://example.test/v1' },
    }));
    localStorage.setItem('gatesai.search.v1', JSON.stringify({
      brave: { apiKey: 'brv-key' },
    }));
    localStorage.setItem('gatesai.ollama.v1', JSON.stringify({
      apiKey: 'ol-key',
      toolsEnabled: false,
      catalog: [],
      lastRefreshAt: 123,
    }));
    const secrets = new Map<string, string>();
    const tauriInvoke = vi.fn(async (cmd: string, args?: Record<string, unknown>) => {
      const name = args?.name as string;
      if (cmd === 'secret_set') {
        secrets.set(name, args?.value as string);
        return undefined;
      }
      if (cmd === 'secret_get') return secrets.get(name) ?? null;
      if (cmd === 'secret_delete') return undefined;
      throw new Error(`unexpected command ${cmd}`);
    }) as TestInvoke;

    const result = await migrateDesktopSecretsFromLocalStorage({ useTauri: true, tauriInvoke });

    expect(result).toEqual({ ok: true, attempted: 3, migrated: 3, skipped: false });
    expect(secrets).toEqual(new Map([
      [SECRET_NAMES.openrouterApiKey, 'sk-or'],
      [SECRET_NAMES.braveApiKey, 'brv-key'],
      [SECRET_NAMES.ollamaApiKey, 'ol-key'],
    ]));
    expect(JSON.parse(localStorage.getItem('gatesai.providers.v1') ?? '{}')).toEqual({
      openrouter: { baseUrl: 'https://example.test/v1' },
    });
    expect(localStorage.getItem('gatesai.search.v1')).toBeNull();
    expect(JSON.parse(localStorage.getItem('gatesai.ollama.v1') ?? '{}')).toEqual({
      toolsEnabled: false,
      catalog: [],
      lastRefreshAt: 123,
    });
    expect(localStorage.getItem(DESKTOP_SECRET_MIGRATION_MARKER)).toBe('1');
  });

  it('leaves localStorage intact when desktop keychain migration fails', async () => {
    const providers = JSON.stringify({ openrouter: { apiKey: 'sk-or' } });
    const search = JSON.stringify({ brave: { apiKey: 'brv-key' } });
    localStorage.setItem('gatesai.providers.v1', providers);
    localStorage.setItem('gatesai.search.v1', search);
    const log = { warn: vi.fn() };
    const tauriInvoke = vi.fn(async (cmd: string) => {
      if (cmd === 'secret_set') throw new Error('credential store locked');
      return null;
    }) as TestInvoke;

    const result = await migrateDesktopSecretsFromLocalStorage({ useTauri: true, tauriInvoke, log });

    expect(result.ok).toBe(false);
    expect(localStorage.getItem('gatesai.providers.v1')).toBe(providers);
    expect(localStorage.getItem('gatesai.search.v1')).toBe(search);
    expect(localStorage.getItem(DESKTOP_SECRET_MIGRATION_MARKER)).toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      'persistence',
      'desktop secret migration failed; keeping localStorage secrets',
      expect.any(Object),
    );
  });
});
