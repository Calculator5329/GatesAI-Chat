import { describe, expect, it, vi } from 'vitest';
import { McpError, type McpToolResult } from '../../src/services/mcp/client';
import { McpStore } from '../../src/stores/McpStore';
import type { SecretStorage } from '../../src/services/secretStorage';
import type { KeyValuePersistence } from '../../src/services/storage/persistenceProvider';
import { MCP_SERVERS_STORAGE_KEY, mcpHeaderSecretName } from '../../src/services/mcp/mcpStorage';

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

function flushPersistence(): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, 0));
}

describe('McpStore', () => {
  it('hydrates header values from secrets and persists updates back through secrets', async () => {
    const storage = new MemoryStorage();
    storage.setItem(MCP_SERVERS_STORAGE_KEY, JSON.stringify([{
      id: 'srv',
      label: 'Server',
      url: 'https://mcp.example.test/mcp',
      enabled: true,
      headers: { Authorization: '' },
    }]));
    const secrets = memorySecrets({
      [mcpHeaderSecretName('srv', 'Authorization')]: 'Bearer old',
    });
    const store = new McpStore({ storage, secrets });

    await store.hydrateHeaderSecrets();
    expect(store.servers[0].headers.Authorization).toBe('Bearer old');

    store.startPersistence();
    store.updateServer('srv', {
      headers: {
        Authorization: 'Bearer new',
        'X-Api-Key': 'key-1',
      },
    });
    await flushPersistence();

    const raw = storage.getItem(MCP_SERVERS_STORAGE_KEY) ?? '';
    expect(raw).toContain('Authorization');
    expect(raw).not.toContain('Bearer new');
    expect(secrets.data.get(mcpHeaderSecretName('srv', 'Authorization'))).toBe('Bearer new');
    expect(secrets.data.get(mcpHeaderSecretName('srv', 'X-Api-Key'))).toBe('key-1');

    store.dispose();
  });

  it('tests connections, records tool counts, and hides disabled servers', async () => {
    const client = {
      mcpSessionId: null,
      connect: vi.fn(async () => undefined),
      listTools: vi.fn(async () => [
        { name: 'echo', description: 'Echo', inputSchema: { type: 'object' } },
      ]),
      callTool: vi.fn(async (): Promise<McpToolResult> => ({
        content: [{ type: 'text', text: 'done' }],
      })),
    };
    const store = new McpStore({ clientFactory: () => client });
    const id = store.addServer({
      label: 'Local MCP',
      url: 'http://127.0.0.1:7332/mcp',
      headers: { Authorization: 'Bearer test' },
    });

    await expect(store.testConnection(id)).resolves.toMatchObject({
      ok: true,
      status: { state: 'connected', toolCount: 1 },
    });
    expect(client.connect).toHaveBeenCalledWith('http://127.0.0.1:7332/mcp', { Authorization: 'Bearer test' });
    expect(store.connectedServers).toHaveLength(1);
    expect(store.connectedServers[0].tools[0].name).toBe('echo');

    await expect(store.callTool(id, 'echo', { text: 'hi' })).resolves.toEqual({
      content: [{ type: 'text', text: 'done' }],
    });
    expect(client.callTool).toHaveBeenCalledWith('echo', { text: 'hi' }, { signal: undefined });

    store.setServerEnabled(id, false);

    expect(store.statusFor(id).state).toBe('disabled');
    expect(store.connectedServers).toHaveLength(0);
  });

  it('maps typed connection failures into status objects', async () => {
    const store = new McpStore({
      clientFactory: () => ({
        connect: vi.fn(async () => { throw new McpError('auth', 'bad token', { status: 401 }); }),
        listTools: vi.fn(async () => []),
        callTool: vi.fn(async () => ({ content: [] })),
      }),
    });
    const id = store.addServer({ label: 'Secure', url: 'https://secure.example.test/mcp' });

    await expect(store.testConnection(id)).resolves.toMatchObject({
      ok: false,
      status: {
        state: 'error',
        errorKind: 'auth',
        message: 'bad token',
      },
    });
    expect(store.connectedServers).toHaveLength(0);
  });
});
