import type { Model } from '../../core/types';

interface RawOpenAiCompatModel {
  id?: unknown;
}

interface RawOpenAiCompatModelsResponse {
  data?: unknown;
}

export const OPENAI_COMPAT_PROVIDER_ID = 'openai-compat' as const;
export const DEFAULT_OPENAI_COMPAT_LABEL = 'Custom';

export function normalizeOpenAiCompatBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  try {
    const url = new URL(trimmed);
    const normalizedPath = url.pathname.replace(/\/+$/, '');
    if (!/\/v1$/i.test(normalizedPath)) {
      url.pathname = `${normalizedPath || ''}/v1`;
    } else {
      url.pathname = normalizedPath;
    }
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return /\/v1$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
  }
}

export function isBlockedHttpRemoteEndpoint(raw: string): boolean {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== 'http:') return false;
    const host = url.hostname.toLowerCase();
    return host !== 'localhost' && host !== '127.0.0.1' && host !== '::1' && host !== '[::1]';
  } catch {
    return false;
  }
}

export async function fetchOpenAiCompatModels(options: {
  baseUrl: string;
  apiKey?: string;
  label?: string;
  signal?: AbortSignal;
}): Promise<Model[]> {
  const baseUrl = normalizeOpenAiCompatBaseUrl(options.baseUrl);
  if (!baseUrl) throw new Error('Enter a base URL first.');
  if (isBlockedHttpRemoteEndpoint(baseUrl)) {
    throw new Error('http endpoints must be localhost; use https for remote');
  }

  const headers: Record<string, string> = {};
  const apiKey = options.apiKey?.trim();
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const res = await fetch(`${baseUrl}/models`, {
    method: 'GET',
    headers,
    signal: options.signal,
  });
  if (!res.ok) {
    throw new Error(`Custom endpoint models HTTP ${res.status} - ${res.statusText}`);
  }
  const body = await res.json() as RawOpenAiCompatModelsResponse;
  return mapOpenAiCompatModels(body, options.label);
}

export function mapOpenAiCompatModels(raw: unknown, label = DEFAULT_OPENAI_COMPAT_LABEL): Model[] {
  const data = raw && typeof raw === 'object' ? (raw as RawOpenAiCompatModelsResponse).data : undefined;
  if (!Array.isArray(data)) return [];
  const vendor = label.trim() || DEFAULT_OPENAI_COMPAT_LABEL;
  const out: Model[] = [];
  const seen = new Set<string>();
  for (const item of data as RawOpenAiCompatModel[]) {
    const providerModelId = typeof item?.id === 'string' ? item.id.trim() : '';
    if (!providerModelId || seen.has(providerModelId)) continue;
    seen.add(providerModelId);
    out.push({
      id: `oc-${safeModelSlug(providerModelId)}`,
      name: providerModelId,
      vendor,
      providerId: OPENAI_COMPAT_PROVIDER_ID,
      providerModelId,
      dynamic: true,
      supportsTools: true,
    });
  }
  return out;
}

function safeModelSlug(slug: string): string {
  return slug.replace(/[^a-zA-Z0-9_.-]/g, '_');
}
