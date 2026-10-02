// Turns the server address a person types for Ollama or ComfyUI into a base URL
// the app appends API paths to. Used by LocalRuntimeStore.setBaseUrl and when
// persisted addresses load.

export const DEFAULT_OLLAMA_BASE_URL = 'http://127.0.0.1:11434';
export const DEFAULT_COMFY_BASE_URL = 'http://127.0.0.1:8188';

const OLLAMA_PORT = 11434;
const COMFY_PORT = 8188;

/**
 * `192.168.1.20` -> `http://192.168.1.20:11434`, `gpu-box:11434/` ->
 * `http://gpu-box:11434`, `https://ollama.example.com/api` ->
 * `https://ollama.example.com`, empty -> the loopback default.
 */
export function normalizeOllamaBaseUrl(input: string): string {
  return normalizeServerBaseUrl(input, OLLAMA_PORT, DEFAULT_OLLAMA_BASE_URL);
}

/** Same rules as normalizeOllamaBaseUrl with ComfyUI's port 8188. */
export function normalizeComfyBaseUrl(input: string): string {
  return normalizeServerBaseUrl(input, COMFY_PORT, DEFAULT_COMFY_BASE_URL);
}

/**
 * True when a base URL points at this computer (localhost, 127.x, ::1).
 * The Local settings card uses it to show the server-only API key field
 * just for remote addresses. Unparseable input counts as not loopback.
 */
export function isLoopbackBaseUrl(baseUrl: string): boolean {
  let host: string;
  try {
    host = new URL(baseUrl).hostname.toLowerCase();
  } catch {
    return false;
  }
  return host === 'localhost' || host === '[::1]' || /^127(?:\.\d{1,3}){3}$/.test(host);
}

/**
 * The same host on Ollama's port when a base URL names none, so it sits on 80
 * or 443: `http://gpu-box` -> `http://gpu-box:11434`. Ollama itself speaks
 * plain http, so the suggestion does too. Undefined when the URL has a port or
 * does not parse. LocalRuntimeStore offers it when a web page answers instead
 * of Ollama.
 */
export function suggestOllamaPortUrl(baseUrl: string): string | undefined {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return undefined;
  }
  if (url.port || (url.protocol !== 'http:' && url.protocol !== 'https:')) return undefined;
  return `http://${url.hostname}:${OLLAMA_PORT}`;
}

/**
 * Adds `http://` and the default port only when the person typed a bare host
 * (a typed scheme means a proxy may be on its standard port). Drops anything
 * from an `/api` segment on, plus query, hash, credentials and trailing
 * slashes. Input that is not an http(s) address comes back trimmed so the
 * probe can report it instead of silently rewriting it.
 */
function normalizeServerBaseUrl(input: string, defaultPort: number, fallback: string): string {
  const trimmed = input.trim();
  if (!trimmed) return fallback;
  const hasScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed);
  let url: URL;
  try {
    url = new URL(hasScheme ? trimmed : `http://${trimmed}`);
  } catch {
    return stripTrailingSlashes(trimmed);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return stripTrailingSlashes(trimmed);
  if (!hasScheme && !hasExplicitPort(trimmed)) url.port = String(defaultPort);
  const apiAt = url.pathname.search(/\/api(?:\/|$)/);
  const path = apiAt >= 0 ? url.pathname.slice(0, apiAt) : url.pathname;
  return `${url.protocol}//${url.host}${stripTrailingSlashes(path)}`;
}

/** Reads the raw text because URL hides a typed `:80` on http. */
function hasExplicitPort(schemeless: string): boolean {
  const authority = schemeless.split(/[/?#]/, 1)[0] ?? '';
  const hostPort = authority.slice(authority.lastIndexOf('@') + 1);
  return /:\d+$/.test(hostPort);
}

function stripTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}
