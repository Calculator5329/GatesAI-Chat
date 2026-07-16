import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BRIDGE_PROTOCOL_VERSION,
  BridgeClient,
  BridgeError,
  BridgeOfflineError,
  LEGACY_BRIDGE_PROTOCOL_VERSION,
} from '../../../src/services/bridge/client';

const CONNECT_TIMEOUT_MS = 3000;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Minimal WebSocket double. Tests drive the connection lifecycle through
 * `open()` / `fail()` / `serverClose()` / `message()` and inspect outgoing
 * frames via `sent`.
 */
class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState: number = FakeWebSocket.CONNECTING;
  sent: string[] = [];

  onopen: ((ev: unknown) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string): void {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new Error('InvalidStateError: socket not open');
    }
    this.sent.push(data);
  }

  close(): void {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }

  /** Simulate the server accepting the connection. */
  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.({});
  }

  /** Simulate a connection error (server unreachable). */
  fail(): void {
    this.onerror?.({});
  }

  /** Simulate the server closing the connection. */
  serverClose(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({});
  }

  /** Simulate an inbound frame. */
  message(data: unknown): void {
    this.onmessage?.({ data });
  }
}

function lastSocket(): FakeWebSocket {
  const ws = FakeWebSocket.instances.at(-1);
  if (!ws) throw new Error('no FakeWebSocket was constructed');
  return ws;
}

async function connectedClient(): Promise<{ client: BridgeClient; ws: FakeWebSocket }> {
  const client = new BridgeClient('ws://127.0.0.1:7331/ws');
  const connecting = client.connect();
  const ws = lastSocket();
  ws.open();
  await connecting;
  return { client, ws };
}

function parseFrame(raw: string): Record<string, unknown> {
  return JSON.parse(raw) as Record<string, unknown>;
}

describe('BridgeClient', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    vi.stubGlobal('WebSocket', FakeWebSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('connect()', () => {
    it('resolves once the socket opens and reports isOpen()', async () => {
      const client = new BridgeClient('ws://test');
      const connecting = client.connect();
      expect(client.isOpen()).toBe(false);

      lastSocket().open();
      await expect(connecting).resolves.toBeUndefined();
      expect(client.isOpen()).toBe(true);
    });

    it('rejects with BridgeOfflineError when the socket errors', async () => {
      const client = new BridgeClient('ws://test');
      const connecting = client.connect();

      lastSocket().fail();
      await expect(connecting).rejects.toBeInstanceOf(BridgeOfflineError);
      expect(client.isOpen()).toBe(false);
    });

    it('rejects with BridgeOfflineError after the connect timeout', async () => {
      const client = new BridgeClient('ws://test');
      const connecting = client.connect();
      const expectation = expect(connecting).rejects.toThrow(
        /Bridge connect timed out/,
      );

      vi.advanceTimersByTime(CONNECT_TIMEOUT_MS);
      await expectation;
      expect(client.isOpen()).toBe(false);
      // Timeout closes the half-open socket so it cannot leak.
      expect(lastSocket().readyState).toBe(FakeWebSocket.CLOSED);
    });

    it('is idempotent: returns the in-flight promise while connecting and resolves immediately when open', async () => {
      const client = new BridgeClient('ws://test');
      const first = client.connect();
      const second = client.connect();
      expect(FakeWebSocket.instances).toHaveLength(1);

      lastSocket().open();
      await Promise.all([first, second]);

      await client.connect();
      expect(FakeWebSocket.instances).toHaveLength(1);
    });
  });

  describe('request()', () => {
    it('throws BridgeOfflineError synchronously when the socket is not open', async () => {
      const client = new BridgeClient('ws://test');
      await expect(client.request('fs.read', {})).rejects.toBeInstanceOf(BridgeOfflineError);
      expect(FakeWebSocket.instances).toHaveLength(0);
    });

    it('correlates two concurrent requests by id and resolves each with its own result', async () => {
      const { client, ws } = await connectedClient();

      const first = client.request<{ value: string }>('fs.read', { path: 'a.txt' });
      const second = client.request<{ value: string }>('fs.read', { path: 'b.txt' });

      expect(ws.sent).toHaveLength(2);
      const frameA = parseFrame(ws.sent[0]);
      const frameB = parseFrame(ws.sent[1]);
      expect(frameA.type).toBe('request');
      expect(frameA.op).toBe('fs.read');
      expect(frameA.id).not.toBe(frameB.id);

      // Answer out of order to prove correlation is by id, not arrival order.
      ws.message(JSON.stringify({ id: frameB.id, type: 'result', data: { value: 'from-b' } }));
      ws.message(JSON.stringify({ id: frameA.id, type: 'result', data: { value: 'from-a' } }));

      await expect(first).resolves.toEqual({ value: 'from-a' });
      await expect(second).resolves.toEqual({ value: 'from-b' });
    });

    it('routes event envelopes to the matching onEvent callback without settling the promise', async () => {
      const { client, ws } = await connectedClient();

      const onEventA = vi.fn();
      const onEventB = vi.fn();
      const first = client.request('exec.run', { cmd: 'a' }, onEventA);
      const second = client.request('exec.run', { cmd: 'b' }, onEventB);
      const idA = parseFrame(ws.sent[0]).id;
      const idB = parseFrame(ws.sent[1]).id;

      ws.message(JSON.stringify({ id: idA, type: 'event', data: { line: 'stdout-a' } }));
      ws.message(JSON.stringify({ id: idB, type: 'event', data: { line: 'stdout-b' } }));
      ws.message(JSON.stringify({ id: idA, type: 'event', data: { line: 'stdout-a2' } }));

      expect(onEventA.mock.calls.map(c => c[0])).toEqual([
        { line: 'stdout-a' },
        { line: 'stdout-a2' },
      ]);
      expect(onEventB).toHaveBeenCalledExactlyOnceWith({ line: 'stdout-b' });

      // Events must not resolve the request; only `result` does.
      ws.message(JSON.stringify({ id: idA, type: 'result', data: { exit_code: 0 } }));
      ws.message(JSON.stringify({ id: idB, type: 'result', data: { exit_code: 1 } }));
      await expect(first).resolves.toEqual({ exit_code: 0 });
      await expect(second).resolves.toEqual({ exit_code: 1 });
    });

    it('rejects with BridgeError carrying message, op, and code on error envelopes', async () => {
      const { client, ws } = await connectedClient();

      const pending = client.request('fs.write', { path: 'denied.txt' });
      const id = parseFrame(ws.sent[0]).id;
      ws.message(JSON.stringify({
        id,
        type: 'error',
        op: 'fs.write',
        data: { message: 'Access denied', code: 'fs_denied' },
      }));

      const err = await pending.then(
        () => { throw new Error('expected rejection'); },
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(BridgeError);
      const bridgeErr = err as BridgeError;
      expect(bridgeErr.message).toBe('Access denied');
      expect(bridgeErr.op).toBe('fs.write');
      expect(bridgeErr.code).toBe('fs_denied');
    });

    it('falls back to a generic message when the error payload is malformed', async () => {
      const { client, ws } = await connectedClient();

      const pending = client.request('fs.read', {});
      const id = parseFrame(ws.sent[0]).id;
      ws.message(JSON.stringify({ id, type: 'error', data: 'not-an-object' }));

      await expect(pending).rejects.toThrow('Bridge error');
    });

    it('times out after 30s with code bridge_timeout and forgets the pending entry', async () => {
      const { client, ws } = await connectedClient();

      const onEvent = vi.fn();
      const pending = client.request('exec.run', {}, onEvent);
      const id = parseFrame(ws.sent[0]).id;
      const expectation = pending.then(
        () => { throw new Error('expected rejection'); },
        (e: unknown) => e,
      );

      vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);
      const err = await expectation;
      expect(err).toBeInstanceOf(BridgeError);
      expect((err as BridgeError).code).toBe('bridge_timeout');

      // The pending entry is gone: late frames for this id are ignored.
      ws.message(JSON.stringify({ id, type: 'event', data: { line: 'late' } }));
      ws.message(JSON.stringify({ id, type: 'result', data: { exit_code: 0 } }));
      expect(onEvent).not.toHaveBeenCalled();
    });

    it('honors a custom request timeout', async () => {
      const { client, ws } = await connectedClient();

      const pending = client.request('exec.run', {}, undefined, { timeoutMs: 60_000 });
      const expectation = pending.then(
        () => { throw new Error('expected rejection'); },
        (e: unknown) => e,
      );

      vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);
      await Promise.resolve();
      ws.message(JSON.stringify({ id: 'unknown', type: 'event', data: {} }));

      vi.advanceTimersByTime(30_000);
      const err = await expectation;
      expect(err).toBeInstanceOf(BridgeError);
      expect((err as BridgeError).message).toContain('60s');
    });

    it('can disable the request timeout for long streaming operations', async () => {
      const { client, ws } = await connectedClient();

      const pending = client.request('exec.run', {}, undefined, { timeoutMs: null });
      const id = parseFrame(ws.sent[0]).id;

      vi.advanceTimersByTime(REQUEST_TIMEOUT_MS * 4);
      ws.message(JSON.stringify({ id, type: 'result', data: { exit_code: 0 } }));

      await expect(pending).resolves.toEqual({ exit_code: 0 });
    });

    it('resets the timeout on event frames when requested', async () => {
      const { client, ws } = await connectedClient();

      const pending = client.request('exec.run', {}, vi.fn(), { timeoutMs: 100, resetTimeoutOnEvent: true });
      const id = parseFrame(ws.sent[0]).id;
      const expectation = pending.then(
        () => { throw new Error('expected rejection'); },
        (e: unknown) => e,
      );

      vi.advanceTimersByTime(90);
      ws.message(JSON.stringify({ id, type: 'event', data: { line: 'still alive' } }));
      vi.advanceTimersByTime(90);
      await Promise.resolve();
      ws.message(JSON.stringify({ id: 'unknown', type: 'event', data: {} }));

      vi.advanceTimersByTime(10);
      const err = await expectation;
      expect(err).toBeInstanceOf(BridgeError);
      expect((err as BridgeError).code).toBe('bridge_timeout');
    });

    it('rejects all pending requests with BridgeOfflineError when the socket closes mid-request', async () => {
      const { client, ws } = await connectedClient();

      const onEvent = vi.fn();
      const first = client.request('fs.read', { path: 'a.txt' }, onEvent);
      const second = client.request('fs.read', { path: 'b.txt' });
      const idA = parseFrame(ws.sent[0]).id;

      ws.serverClose();

      await expect(first).rejects.toBeInstanceOf(BridgeOfflineError);
      await expect(second).rejects.toBeInstanceOf(BridgeOfflineError);
      expect(client.isOpen()).toBe(false);

      // The pending map was cleared: a late frame routes nowhere.
      ws.message(JSON.stringify({ id: idA, type: 'event', data: { line: 'late' } }));
      expect(onEvent).not.toHaveBeenCalled();
    });

    it('adds privileged:true to the envelope only when requested', async () => {
      const { client, ws } = await connectedClient();

      const privileged = client.request('fs.write', { path: 'chat.json' }, undefined, { privileged: true });
      const normal = client.request('fs.write', { path: 'notes.txt' });

      expect(ws.sent[0]).toContain('"privileged":true');
      expect(parseFrame(ws.sent[0]).privileged).toBe(true);
      expect(ws.sent[1]).not.toContain('privileged');
      expect('privileged' in parseFrame(ws.sent[1])).toBe(false);

      for (const frame of ws.sent) {
        const { id } = parseFrame(frame);
        ws.message(JSON.stringify({ id, type: 'result', data: {} }));
      }
      await Promise.all([privileged, normal]);
    });

    it('ignores malformed inbound frames without throwing or settling requests', async () => {
      const { client, ws } = await connectedClient();

      const resolved = vi.fn();
      const rejected = vi.fn();
      const pending = client.request('fs.read', {});
      void pending.then(resolved, rejected);
      const id = parseFrame(ws.sent[0]).id;

      expect(() => {
        ws.message('not json at all {{{');
        ws.message(JSON.stringify({ type: 'result', data: {} })); // missing id
        ws.message(JSON.stringify({ id, data: {} })); // missing type
        ws.message(JSON.stringify({ id, type: 'bogus', data: {} })); // unknown type
        ws.message(JSON.stringify({ id: 'j-1-9999', type: 'result', data: {} })); // unknown id
        ws.message(JSON.stringify(null));
        ws.message(JSON.stringify([1, 2, 3]));
        ws.message(12345); // non-string payload (e.g. binary frame)
      }).not.toThrow();

      await Promise.resolve();
      expect(resolved).not.toHaveBeenCalled();
      expect(rejected).not.toHaveBeenCalled();

      // The request is still live and resolves normally afterwards.
      ws.message(JSON.stringify({ id, type: 'result', data: { ok: true } }));
      await expect(pending).resolves.toEqual({ ok: true });
    });
  });

  describe('negotiateProtocol()', () => {
    it('sends the v2 hello frame and resolves the bridge reply', async () => {
      const { client, ws } = await connectedClient();

      const negotiation = client.negotiateProtocol();
      expect(parseFrame(ws.sent[0])).toEqual({
        type: 'hello',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
      });

      ws.message(JSON.stringify({
        type: 'hello',
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
      }));

      await expect(negotiation).resolves.toBe(BRIDGE_PROTOCOL_VERSION);
    });

    it('classifies a silent pre-handshake bridge as legacy after the grace window', async () => {
      const { client } = await connectedClient();

      const negotiation = client.negotiateProtocol(250);
      vi.advanceTimersByTime(250);

      await expect(negotiation).resolves.toBe(LEGACY_BRIDGE_PROTOCOL_VERSION);
    });

    it('classifies a connection closed during negotiation as legacy', async () => {
      const { client, ws } = await connectedClient();

      const negotiation = client.negotiateProtocol();
      ws.serverClose();

      await expect(negotiation).resolves.toBe(LEGACY_BRIDGE_PROTOCOL_VERSION);
      expect(client.isOpen()).toBe(false);
    });

    it('ignores malformed hello replies until a valid integer version arrives', async () => {
      const { client, ws } = await connectedClient();

      const negotiation = client.negotiateProtocol();
      ws.message(JSON.stringify({ type: 'hello', protocolVersion: '2' }));
      ws.message(JSON.stringify({ type: 'hello', protocolVersion: 2.5 }));
      ws.message(JSON.stringify({ type: 'hello' }));
      ws.message(JSON.stringify({ type: 'hello', protocolVersion: BRIDGE_PROTOCOL_VERSION }));

      await expect(negotiation).resolves.toBe(BRIDGE_PROTOCOL_VERSION);
    });
  });
});
