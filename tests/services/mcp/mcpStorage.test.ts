import { describe, expect, it } from 'vitest';
import {
  MCP_SERVERS_STORAGE_KEY,
  collectMcpHeaderSecretNames,
  createMcpServerConfigsPersistence,
  hydrateMcpServerHeaderSecrets,
  mcpHeaderSecretName,
  persistMcpServerHeaderSecrets,
  redactMcpServerHeaderValues,
  type McpServerConfig,
} from '../../../src/services/mcp/mcpStorage';
import type { SecretStorage } from '../../../src/services/secretStorage';
import type { KeyValuePersistence } from '../../../src/services/storage/persistenceProvider';

class MemoryStorage implements KeyValuePersistence {
  readonly data = new Map<string, string>();
  getItem(key: string): string | null { return this.data.get(key) ?? null; }
  setItem(key: string, value: string): void { this.data.set(key, value); }
  removeItem(key: string): void { this.data.delete(key); }
}

function memorySecrets(seed: Record<string, string> = {}): SecretStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    async getSecret(name) { return data.get(name) ?? null; },
    async setSecret(name, value) { data.set(name, value); },
    async deleteSecret(name) { data.delete(name); },
  };
}

describe('mcpStorage', () => {
  it('persists server metadata while storing header values through SecretStorage', async () => {
    const storage = new MemoryStorage();
    const secrets = memorySecrets();
    const persistence = createMcpServerConfigsPersistence(storage);
    const servers: McpServerConfig[] = [{
      id: 'srv-alpha',
      label: 'Alpha',
      url: 'https://alpha.example.test/mcp',
      enabled: true,
      headers: {
        Authorization: 'Bearer secret-token',
        'X-Api-Key': 'api-secret',
      },
    }];

    persistence.save(redactMcpServerHeaderValues(servers));
    await persistMcpServerHeaderSecrets(servers, [], secrets);

    const raw = storage.getItem(MCP_SERVERS_STORAGE_KEY) ?? '';
    expect(raw).toContain('Authorization');
    expect(raw).not.toContain('secret-token');
    expect(raw).not.toContain('api-secret');
    expect(secrets.data.get(mcpHeaderSecretName('srv-alpha', 'Authorization'))).toBe('Bearer secret-token');
    expect(secrets.data.get(mcpHeaderSecretName('srv-alpha', 'X-Api-Key'))).toBe('api-secret');

    const loaded = persistence.load();
    expect(loaded[0].headers).toEqual({ Authorization: '', 'X-Api-Key': '' });
    await expect(hydrateMcpServerHeaderSecrets(loaded, secrets)).resolves.toEqual(servers);
  });

  it('deletes stale header secrets when servers or headers are removed', async () => {
    const oldServers: McpServerConfig[] = [{
      id: 'old',
      label: 'Old',
      url: 'https://old.example.test/mcp',
      enabled: true,
      headers: { Authorization: 'old-secret' },
    }];
    const nextServers: McpServerConfig[] = [{
      id: 'next',
      label: 'Next',
      url: 'https://next.example.test/mcp',
      enabled: true,
      headers: { Authorization: 'next-secret' },
    }];
    const secrets = memorySecrets({
      [mcpHeaderSecretName('old', 'Authorization')]: 'old-secret',
    });

    const names = await persistMcpServerHeaderSecrets(nextServers, collectMcpHeaderSecretNames(oldServers), secrets);

    expect(names).toEqual(collectMcpHeaderSecretNames(nextServers));
    expect(secrets.data.get(mcpHeaderSecretName('old', 'Authorization'))).toBeUndefined();
    expect(secrets.data.get(mcpHeaderSecretName('next', 'Authorization'))).toBe('next-secret');
  });

  it('normalizes legacy raw data and keeps legacy header values available for migration', () => {
    const storage = new MemoryStorage();
    storage.setItem(MCP_SERVERS_STORAGE_KEY, JSON.stringify({
      servers: [
        {
          id: 'Srv One',
          label: '  Local Tools  ',
          url: ' http://127.0.0.1:7332/mcp ',
          enabled: true,
          headers: {
            Authorization: 'Bearer legacy',
            'Bad Header': 'ignored',
          },
        },
      ],
    }));

    const loaded = createMcpServerConfigsPersistence(storage).load();

    expect(loaded).toEqual([{
      id: 'srv-one',
      label: 'Local Tools',
      url: 'http://127.0.0.1:7332/mcp',
      enabled: true,
      headers: { Authorization: 'Bearer legacy' },
    }]);
  });
});
