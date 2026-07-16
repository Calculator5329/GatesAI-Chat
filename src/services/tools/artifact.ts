// Defines the artifact tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import {
  HTML_ARTIFACT_MAX_BYTES,
  HTML_ARTIFACT_WARN_BYTES,
} from '../../core/htmlArtifactPolicy';
import {
  HTML_ARTIFACT_ROOT,
  htmlArtifactPath,
  isHtmlArtifactId,
  type HtmlArtifactIndex,
  type HtmlArtifactRecord,
} from '../../core/htmlArtifacts';
import type { FsReadResp, FsStatResp, FsWriteResp } from '../../core/workspace';
import {
  loadHtmlArtifactIndex,
  nextHtmlArtifactId,
  writeHtmlArtifactIndex,
} from '../artifacts/artifactRegistry';
import { BridgeOfflineError } from '../bridge/client';
import { logger } from '../diagnostics/logger';
import { requireBridgeOutcome } from './requireBridge';
import type { BridgeClientFacade, Tool, ToolContext, ToolOutcome, ToolValidationIssue } from './types';

type ArtifactAction = 'validate_html' | 'create_html_artifact' | 'update_html_artifact' | 'list_artifacts';

export const artifactTool: Tool = {
  def: {
    name: 'artifact',
    description: [
      'Create and validate user-facing workspace artifacts.',
      '',
      'Use this for finished deliverables instead of hand-rolling repeated fs calls.',
      'For requests like "make a cool HTML game", call create_html_artifact once with a title and complete HTML document.',
      'Actions:',
      '- `validate_html` checks an existing HTML artifact for file presence, non-empty content, basic HTML shape, inline script syntax, and missing local assets.',
      '- `create_html_artifact` assigns a stable id, statically validates and smoke-renders the candidate, then writes it under /workspace/artifacts/html/.',
      '- `update_html_artifact` reuses an existing id, validates before writing, and bumps its registry revision.',
      '- `list_artifacts` returns the versioned HTML artifact registry.',
      '',
      'Create once and update in place by id; never fork a second artifact just to fix the first.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['validate_html', 'create_html_artifact', 'update_html_artifact', 'list_artifacts'],
        },
        path: { type: 'string', description: 'A /workspace/artifacts/... HTML path for validate_html. Legacy create calls may supply this instead of title.' },
        title: { type: 'string', description: 'User-facing title for create_html_artifact.' },
        id: { type: 'string', description: 'Stable artifact id for update_html_artifact.' },
        content: { type: 'string', description: 'Complete HTML content for create_html_artifact or update_html_artifact.' },
      },
      required: ['action'],
      additionalProperties: false,
    },
    strict: true,
  },
  meta: {
    category: 'workspace',
    isReadOnly: args => args.action === 'validate_html',
    hasSideEffects: args => args.action !== 'validate_html',
    resultPolicy: { maxChars: 8_000, summarizeLargeOutput: false },
    validate: validateArtifactArgs,
  },

  async execute(args, ctx) {
    const guard = requireBridgeOutcome(ctx);
    if (!guard.ok) return guard;

    const action = stringArg(args.action) as ArtifactAction;
    const path = stringArg(args.path);

    try {
      if (action === 'create_html_artifact') {
        const content = typeof args.content === 'string' ? args.content : '';
        const title = stringArg(args.title) || titleFromLegacyPath(path);
        const sizeBytes = utf8Size(content);
        if (sizeBytes > HTML_ARTIFACT_MAX_BYTES) {
          return artifactTooLarge(path || `${HTML_ARTIFACT_ROOT}/<new-artifact>.html`, sizeBytes);
        }
        const index = await loadHtmlArtifactIndex(guard.bridge.client, { migrate: false, threadId: ctx.threadId });
        const id = nextHtmlArtifactId(title, index.artifacts);
        return await createOrUpdateArtifact({
          action: 'create', id, title, content, revision: 1, index, ctx,
          client: guard.bridge.client,
        });
      }

      if (action === 'update_html_artifact') {
        const id = stringArg(args.id);
        const content = typeof args.content === 'string' ? args.content : '';
        const index = await loadHtmlArtifactIndex(guard.bridge.client, { threadId: ctx.threadId });
        const current = index.artifacts.find(record => record.id === id);
        if (!current) {
          return errorOutcome('artifact_not_found', `No HTML artifact is registered with id "${id}".`, 'Call list_artifacts and retry with an existing id.', { id });
        }
        return await createOrUpdateArtifact({
          action: 'update', id, title: current.title, content,
          revision: current.revision + 1, current, index, ctx,
          client: guard.bridge.client,
        });
      }

      if (action === 'list_artifacts') {
        const index = await loadHtmlArtifactIndex(guard.bridge.client, { threadId: ctx.threadId });
        return {
          ok: true,
          summary: index.artifacts.length === 0
            ? 'No HTML artifacts are registered.'
            : `Found ${index.artifacts.length} registered HTML artifact${index.artifacts.length === 1 ? '' : 's'}.`,
          data: index,
        } satisfies ToolOutcome;
      }

      if (action === 'validate_html') {
        if (!path) return errorOutcome('missing_required_argument', '`path` is required.', 'Retry with a /workspace/artifacts/... HTML path.');
        return await validateHtmlArtifact(path, guard.bridge.client);
      }

      return errorOutcome('unknown_action', `Unknown artifact action "${String(args.action)}".`, 'Use a documented artifact action.');
    } catch (err) {
      if (err instanceof BridgeOfflineError) return errorOutcome('bridge_offline', err.message, 'Start the bridge, then retry.');
      return errorOutcome('artifact_error', (err as Error).message, 'Inspect the path/content and retry if the artifact is still needed.');
    }
  },
};

function validateArtifactArgs(args: Record<string, unknown>): ToolValidationIssue | null {
  const action = stringArg(args.action);
  const path = stringArg(args.path);
  if (!['validate_html', 'create_html_artifact', 'update_html_artifact', 'list_artifacts'].includes(action)) return null;
  if (action === 'validate_html' && !path) {
    return {
      errorCode: 'missing_required_argument',
      summary: '`path` is required for artifact.',
      fix: 'Retry with a /workspace/artifacts/... HTML path.',
      retryable: true,
    };
  }
  if (action === 'validate_html' && !isWorkspaceArtifactHtmlPath(path)) {
    return {
      errorCode: 'invalid_artifact_path',
      summary: 'HTML artifacts must use a .html or .htm path under /workspace/artifacts/.',
      fix: 'Retry with a path like /workspace/artifacts/exports/app.html.',
      retryable: true,
    };
  }
  if ((action === 'create_html_artifact' || action === 'update_html_artifact') && typeof args.content !== 'string') {
    return {
      errorCode: 'missing_required_argument',
      summary: `\`content\` is required for artifact action "${action}".`,
      fix: 'Retry with complete HTML content.',
      retryable: true,
    };
  }
  if ((action === 'create_html_artifact' || action === 'update_html_artifact') && typeof args.content === 'string' && args.content.trim() === '') {
    return {
      errorCode: 'empty_artifact_content',
      summary: 'HTML artifact content must not be empty.',
      fix: 'Retry with a complete HTML document.',
      retryable: true,
    };
  }
  if (action === 'create_html_artifact' && !stringArg(args.title) && !path) {
    return {
      errorCode: 'missing_required_argument',
      summary: '`title` is required for artifact action "create_html_artifact".',
      fix: 'Retry with a short user-facing artifact title.',
      retryable: true,
    };
  }
  if (action === 'update_html_artifact' && !isHtmlArtifactId(stringArg(args.id))) {
    return {
      errorCode: 'invalid_artifact_id',
      summary: '`id` must be a stable lowercase artifact id for update_html_artifact.',
      fix: 'Call list_artifacts and retry with an existing id.',
      retryable: true,
    };
  }
  return null;
}

async function createOrUpdateArtifact(options: {
  action: 'create' | 'update';
  id: string;
  title: string;
  content: string;
  revision: number;
  current?: HtmlArtifactRecord;
  index: HtmlArtifactIndex;
  ctx: ToolContext;
  client: BridgeClientFacade;
}): Promise<ToolOutcome> {
  const { action, id, title, content, revision, current, index, ctx, client } = options;
  const path = htmlArtifactPath(id);
  const sizeBytes = utf8Size(content);
  if (sizeBytes > HTML_ARTIFACT_MAX_BYTES) return artifactTooLarge(path, sizeBytes);

  const staticIssues = await validateHtmlContent(path, content, client);
  if (staticIssues.length > 0) {
    logArtifactFailure(ctx, id, revision, 'static', staticIssues);
    return invalidArtifact(path, staticIssues, id, revision);
  }
  if (!ctx.artifactValidation) {
    const issues = ['smoke-render validator is unavailable'];
    logArtifactFailure(ctx, id, revision, 'smoke', issues);
    return errorOutcome(
      'artifact_smoke_unavailable',
      `HTML artifact smoke render could not run for ${id}.`,
      'Retry when the desktop artifact validator is available.',
      { id, revision, issues },
    );
  }
  const smoke = await ctx.artifactValidation.smokeRender(content, { signal: ctx.signal });
  if (!smoke.ok) {
    logArtifactFailure(ctx, id, revision, 'smoke', smoke.errors);
    return errorOutcome(
      'artifact_smoke_failed',
      `HTML artifact smoke render failed for ${id}: ${smoke.errors.join('; ')}.`,
      'Fix the runtime or CSP errors, then retry the same create/update action.',
      { id, revision, issues: smoke.errors },
    );
  }

  await client.request('fs.mkdir', { path: HTML_ARTIFACT_ROOT });
  const write = await client.request<FsWriteResp>('fs.write', { path, content, encoding: 'utf8' });
  const now = new Date().toISOString();
  const record: HtmlArtifactRecord = {
    id,
    title,
    threadId: current?.threadId ?? ctx.threadId,
    createdAt: current?.createdAt ?? now,
    updatedAt: now,
    revision,
    sizeBytes: write.bytes ?? sizeBytes,
  };
  const artifacts = current
    ? index.artifacts.map(existing => existing.id === id ? record : existing)
    : [...index.artifacts, record];
  await writeHtmlArtifactIndex(client, { ...index, artifacts });
  await ctx.artifacts?.refresh();
  ctx.artifactSurface?.openArtifact(id);
  return {
    ok: true,
    summary: `${action === 'create' ? 'Created' : 'Updated'} and validated HTML artifact ${id} (revision ${revision}) at ${path}.`,
    data: {
      artifact: record,
      path,
      warnings: sizeBytes > HTML_ARTIFACT_WARN_BYTES
        ? [`HTML artifact is over ${HTML_ARTIFACT_WARN_BYTES} bytes; consider simplifying it.`]
        : [],
      validation: { static: 'passed', smoke: 'passed' },
    },
  };
}

async function validateHtmlArtifact(path: string, client: { request<T = unknown>(op: string, data: unknown): Promise<T> }): Promise<ToolOutcome> {
  const stat = await client.request<FsStatResp>('fs.stat', { path });
  if (stat.size > HTML_ARTIFACT_MAX_BYTES) return artifactTooLarge(path, stat.size);
  const read = await client.request<FsReadResp>('fs.read', { path, encoding: 'utf8' });
  const content = typeof read.content === 'string' ? read.content : '';
  const issues = await validateHtmlContent(path, content, client, stat);

  if (issues.length > 0) {
    return invalidArtifact(path, issues);
  }

  return {
    ok: true,
    summary: `Validated HTML artifact at ${path}.`,
    data: {
      path,
      size: stat.size,
      inlineScripts: countInlineScripts(content),
      localAssetsChecked: localAssetRefs(content).length,
      warnings: stat.size > HTML_ARTIFACT_WARN_BYTES
        ? [`HTML artifact is over ${HTML_ARTIFACT_WARN_BYTES} bytes; consider simplifying it.`]
        : [],
    },
  };
}

async function validateHtmlContent(
  path: string,
  content: string,
  client: { request<T = unknown>(op: string, data: unknown): Promise<T> },
  stat?: FsStatResp,
): Promise<string[]> {
  const issues: string[] = [];
  if (stat?.kind && stat.kind !== 'file') issues.push('path is not a file');
  if ((stat && stat.size <= 0) || content.trim().length === 0) issues.push('file is empty');
  if (!/<!doctype\s+html/i.test(content) && !/<html[\s>]/i.test(content)) issues.push('missing <!doctype html> or <html> root');
  if (!/<body[\s>]/i.test(content) && !/<canvas[\s>]/i.test(content) && !/<main[\s>]/i.test(content)) {
    issues.push('missing visible body/main/canvas content');
  }
  issues.push(...validateInlineScripts(content));
  const missingAssets = await missingLocalAssets(path, content, client);
  if (missingAssets.length > 0) {
    issues.push(`missing local assets: ${missingAssets.slice(0, 6).join(', ')}${missingAssets.length > 6 ? `, and ${missingAssets.length - 6} more` : ''}`);
  }
  return issues;
}

function invalidArtifact(path: string, issues: string[], id?: string, revision?: number): ToolOutcome {
  return errorOutcome(
    'invalid_html_artifact',
    `HTML artifact validation failed for ${path}: ${issues.join('; ')}.`,
    'Fix the HTML or missing asset references, then validate again.',
    { path, ...(id ? { id } : {}), ...(revision ? { revision } : {}), issues },
  );
}

function artifactTooLarge(path: string, sizeBytes: number): ToolOutcome {
  return errorOutcome(
    'artifact_too_large',
    `HTML artifact at ${path} is ${sizeBytes} bytes; the limit is ${HTML_ARTIFACT_MAX_BYTES} bytes.`,
    'Simplify or split the deliverable, then retry without writing the oversized document.',
    { path, sizeBytes, maxBytes: HTML_ARTIFACT_MAX_BYTES },
  );
}

function logArtifactFailure(
  ctx: ToolContext,
  id: string,
  revision: number,
  phase: 'static' | 'smoke',
  issues: string[],
): void {
  logger.error('html-artifacts', `${phase} validation failed for ${id} revision ${revision}`, {
    artifactId: id,
    revision,
    threadId: ctx.threadId,
    phase,
    issues,
  });
}

function utf8Size(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

function validateInlineScripts(html: string): string[] {
  const issues: string[] = [];
  let index = 0;
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    index += 1;
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    if (/\bsrc\s*=/i.test(attrs) || /\btype\s*=\s*["']?(application\/json|importmap)/i.test(attrs)) continue;
    if (body.trim() === '') continue;
    try {
      // Syntax check only; the function is never invoked.
      new Function(body);
    } catch (err) {
      issues.push(`inline script ${index} has a syntax error: ${(err as Error).message}`);
    }
  }
  return issues;
}

async function missingLocalAssets(
  htmlPath: string,
  html: string,
  client: { request<T = unknown>(op: string, data: unknown): Promise<T> },
): Promise<string[]> {
  const missing: string[] = [];
  for (const ref of localAssetRefs(html)) {
    const path = resolveWorkspaceRef(htmlPath, ref);
    if (!path) continue;
    try {
      await client.request<FsStatResp>('fs.stat', { path });
    } catch {
      missing.push(ref);
    }
  }
  return missing;
}

function localAssetRefs(html: string): string[] {
  const refs = new Set<string>();
  for (const match of html.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
    const ref = match[1]?.trim();
    if (!ref || isExternalRef(ref) || ref.startsWith('#')) continue;
    refs.add(ref);
  }
  return [...refs];
}

function resolveWorkspaceRef(htmlPath: string, ref: string): string | null {
  if (ref.startsWith('/workspace/')) return normalizeWorkspacePath(ref);
  if (ref.startsWith('/')) return null;
  const base = parentWorkspacePath(htmlPath);
  if (!base) return null;
  const parts = `${base}/${ref}`.split('/').filter(Boolean);
  const out: string[] = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return normalizeWorkspacePath(`/${out.join('/')}`);
}

function isWorkspaceArtifactHtmlPath(path: string): boolean {
  const normalized = normalizeWorkspacePath(path);
  return normalized.startsWith('/workspace/artifacts/') && /\.html?$/i.test(normalized);
}

function parentWorkspacePath(path: string): string | null {
  const normalized = normalizeWorkspacePath(path);
  const index = normalized.lastIndexOf('/');
  if (index <= '/workspace'.length) return null;
  return normalized.slice(0, index);
}

function titleFromLegacyPath(path: string): string {
  const name = path.split('/').filter(Boolean).pop()?.replace(/\.html?$/i, '') ?? '';
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map(word => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(' ') || 'Artifact';
}

function normalizeWorkspacePath(path: string): string {
  const normalized = path.replace(/\\/g, '/').trim();
  if (normalized.startsWith('/workspace/')) return normalized.replace(/\/+/g, '/');
  return `/workspace/${normalized.replace(/^\/+/, '')}`.replace(/\/+/g, '/');
}

function stringArg(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isExternalRef(ref: string): boolean {
  return /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(ref)
    || /^(?:data|blob|mailto|tel):/i.test(ref);
}

function countInlineScripts(html: string): number {
  return [...html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi)].length;
}

function errorOutcome(errorCode: string, summary: string, fix: string, data?: unknown): ToolOutcome {
  return {
    ok: false,
    errorCode,
    summary,
    fix,
    retryable: true,
    ...(data !== undefined ? { data } : {}),
  };
}
