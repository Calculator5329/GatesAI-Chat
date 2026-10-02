// Maps Ollama's GET /api/tags body into chat models.
// Called by OllamaStore.applyTags after LocalRuntimeStore's reachability probe.
// Invariant: reported capabilities win; name rules only fill in for older Ollama builds that omit them.
import type { OllamaCatalogModel } from '../../core/localModelMeta';
import { isRecord } from '../../core/guards';
import { modelSupportsVision } from '../../core/modelCapabilities';
import {
  isOllamaEmbeddingModelTag,
  ollamaModelSupportsTools,
} from '../../core/localModelRules';

interface OllamaTagsPayload {
  models: unknown[];
}

/** True when a body looks like /api/tags. Lets a probe tell Ollama from some other server on the port. */
export function isOllamaTagsPayload(v: unknown): v is OllamaTagsPayload {
  return isRecord(v) && Array.isArray(v.models);
}

export function extractOllamaTagNames(raw: unknown): string[] {
  if (!isOllamaTagsPayload(raw)) return [];
  return raw.models
    .map(tag => (isRecord(tag) ? tag.name : undefined))
    .filter((name): name is string => typeof name === 'string' && name.length > 0);
}

/**
 * Converts `GET /api/tags` into chat models with stable `ollama-` ids. When
 * an entry carries `capabilities` (Ollama 0.6+), models without `completion`
 * are dropped and tools, vision and thinking come from that list. Older
 * entries fall back to the name rules in core/localModelRules and
 * core/modelCapabilities. `details.context_length` is the trained maximum,
 * not the window Ollama runs with, so it lands in `maxContextLength` and
 * `contextLength` stays unset: budgeting keeps the provider default.
 */
export function mapOllamaTagsToModels(raw: unknown): OllamaCatalogModel[] {
  if (!isOllamaTagsPayload(raw)) return [];
  const out: OllamaCatalogModel[] = [];
  for (const tag of raw.models) {
    if (!isRecord(tag) || typeof tag.name !== 'string' || !tag.name) continue;
    const providerModelId = tag.name;
    const reported = reportedCapabilities(tag.capabilities);
    if (reported ? !reported.includes('completion') : isOllamaEmbeddingModelTag(providerModelId)) continue;
    const maxContextLength = reportedContextLength(tag.details);
    const parameterBillions = reportedParameterBillions(tag.details);
    out.push({
      id: `ollama-${providerModelId}`,
      providerId: 'ollama',
      providerModelId,
      // Ollama's /api/tags exposes only the tag id, no friendly name.
      name: providerModelId,
      vendor: 'Ollama',
      dynamic: true,
      supportsVision: reported
        ? reported.includes('vision')
        : modelSupportsVision({ providerId: 'ollama', providerModelId }),
      supportsTools: reported ? reported.includes('tools') : ollamaModelSupportsTools(providerModelId),
      ...(reported ? { supportsThinking: reported.includes('thinking') } : {}),
      ...(maxContextLength ? { maxContextLength } : {}),
      ...(parameterBillions ? { parameterBillions } : {}),
      ...(typeof tag.remote_host === 'string' && tag.remote_host ? { remoteHost: tag.remote_host } : {}),
    });
  }
  return out;
}

function reportedCapabilities(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === 'string');
}

function reportedContextLength(details: unknown): number | undefined {
  if (!isRecord(details)) return undefined;
  const length = details.context_length;
  return typeof length === 'number' && Number.isFinite(length) && length > 0 ? length : undefined;
}

const BILLIONS_PER_UNIT: Record<string, number> = { K: 1e-6, M: 1e-3, B: 1, T: 1e3 };

/** Parses `details.parameter_size` ("12.2B", "4B", "567M") into billions. */
function reportedParameterBillions(details: unknown): number | undefined {
  if (!isRecord(details) || typeof details.parameter_size !== 'string') return undefined;
  const match = /^\s*(\d+(?:\.\d+)?)\s*([KMBT])\s*$/i.exec(details.parameter_size);
  if (!match) return undefined;
  const billions = Number(match[1]) * (BILLIONS_PER_UNIT[match[2].toUpperCase()] ?? 0);
  return billions > 0 ? billions : undefined;
}
