// Stateless bridge health probe. Network lives in the service layer, so the
// store never calls `fetch` directly — it asks this for a parsed snapshot and
// owns only the observable state transitions.
const HEALTH_URL = 'http://127.0.0.1:7331/health';

export interface BridgeHealth {
  status: string;
  version: string;
  workspace_root: string;
  platform: string;
  allowlist: string[];
}

/**
 * GET the bridge `/health` endpoint with a short timeout. Resolves with the
 * parsed health payload or throws on a non-2xx / network / timeout error — the
 * caller treats any rejection as "bridge offline".
 */
export async function probeBridgeHealth(timeoutMs = 1500): Promise<BridgeHealth> {
  const res = await fetch(HEALTH_URL, {
    method: 'GET',
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`health ${res.status}`);
  return (await res.json()) as BridgeHealth;
}
