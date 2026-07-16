// Defines the artifact tool contract, validation, execution, or display formatting.
// Called by ChatStore tool rounds via the registry; depends on ToolContext facades and bridge/store services.
// Invariant: tools validate inputs first and return deterministic, user-readable results.
import type { FsReadResp, FsStatResp, FsWriteResp } from '../../core/workspace';
import {
  HTML_ARTIFACT_MAX_BYTES,
  HTML_ARTIFACT_WARN_BYTES,
} from '../../core/htmlArtifactPolicy';
import { BridgeOfflineError } from '../bridge/client';
import { requireBridgeOutcome } from './requireBridge';
import type { Tool, ToolOutcome, ToolValidationIssue } from './types';

type ArtifactAction = 'validate_html' | 'create_html_artifact';

export const artifactTool: Tool = {
  def: {
    name: 'artifact',
    description: [
      'Create and validate user-facing workspace artifacts.',
      '',
      'Use this for finished deliverables instead of hand-rolling repeated fs calls.',
      'For requests like "make a cool HTML game", call create_html_artifact once with a complete HTML document.',
      'Actions:',
      '- `validate_html` checks an existing HTML artifact for file presence, non-empty content, basic HTML shape, inline script syntax, and missing local assets.',
      '- `create_html_artifact` writes an HTML artifact, then runs the same validation before returning the final path.',
      '',
      'Put finished HTML games/apps/reports under /workspace/artifacts/reports or /workspace/artifacts/exports.',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['validate_html', 'create_html_artifact'],
        },
        path: { type: 'string', description: 'A /workspace/artifacts/... HTML path.' },
        content: { type: 'string', description: 'HTML content for create_html_artifact.' },
      },
      required: ['action', 'path'],
      additionalProperties: false,
    },
    strict: true,
  },
  meta: {
    category: 'workspace',
    isReadOnly: args => args.action === 'validate_html',
    hasSideEffects: args => args.action === 'create_html_artifact',
    resultPolicy: { maxChars: 8_000, summarizeLargeOutput: false },
    validate: validateArtifactArgs,
  },

  async execute(args, ctx) {
    const guard = requireBridgeOutcome(ctx);
    if (!guard.ok) return guard;

    const action = stringArg(args.action) as ArtifactAction;
    const path = stringArg(args.path);
    if (!path) return errorOutcome('missing_required_argument', '`path` is required.', 'Retry with a /workspace/artifacts/... HTML path.');

    try {
      if (action === 'create_html_artifact') {
        const content = typeof args.content === 'string' ? args.content : '';
        const sizeBytes = utf8Size(content);
        if (sizeBytes > HTML_ARTIFACT_MAX_BYTES) return artifactTooLarge(path, sizeBytes);
        const dir = parentWorkspacePath(path);
        if (dir) await guard.bridge.client.request('fs.mkdir', { path: dir });
        const write = await guard.bridge.client.request<FsWriteResp>('fs.write', {
          path,
          content,
          encoding: 'utf8',
        });
        const validation = await validateHtmlArtifact(path, guard.bridge.client);
        if (!validation.ok) return validation;
        return {
          ok: true,
          summary: `Created and validated HTML artifact at ${write.path ?? path}.`,
          data: {
            path: write.path ?? path,
            bytes: write.bytes,
            validation: validation.data,
          },
        } satisfies ToolOutcome;
      }

      if (action === 'validate_html') {
        return await validateHtmlArtifact(path, guard.bridge.client);
      }

      return errorOutcome('unknown_action', `Unknown artifact action "${String(args.action)}".`, 'Use action "validate_html" or "create_html_artifact".');
    } catch (err) {
      if (err instanceof BridgeOfflineError) return errorOutcome('bridge_offline', err.message, 'Start the bridge, then retry.');
      return errorOutcome('artifact_error', (err as Error).message, 'Inspect the path/content and retry if the artifact is still needed.');
    }
  },
};

function validateArtifactArgs(args: Record<string, unknown>): ToolValidationIssue | null {
  const action = stringArg(args.action);
  const path = stringArg(args.path);
  if (action !== 'validate_html' && action !== 'create_html_artifact') return null;
  if (!path) {
    return {
      errorCode: 'missing_required_argument',
      summary: '`path` is required for artifact.',
      fix: 'Retry with a /workspace/artifacts/... HTML path.',
      retryable: true,
    };
  }
  if (!isWorkspaceArtifactHtmlPath(path)) {
    return {
      errorCode: 'invalid_artifact_path',
      summary: 'HTML artifacts must use a .html or .htm path under /workspace/artifacts/.',
      fix: 'Retry with a path like /workspace/artifacts/exports/app.html.',
      retryable: true,
    };
  }
  if (action === 'create_html_artifact' && typeof args.content !== 'string') {
    return {
      errorCode: 'missing_required_argument',
      summary: '`content` is required for artifact action "create_html_artifact".',
      fix: 'Retry with complete HTML content.',
      retryable: true,
    };
  }
  if (action === 'create_html_artifact' && typeof args.content === 'string' && args.content.trim() === '') {
    return {
      errorCode: 'empty_artifact_content',
      summary: 'HTML artifact content must not be empty.',
      fix: 'Retry with a complete HTML document.',
      retryable: true,
    };
  }
  return null;
}

async function validateHtmlArtifact(path: string, client: { request<T = unknown>(op: string, data: unknown): Promise<T> }): Promise<ToolOutcome> {
  const stat = await client.request<FsStatResp>('fs.stat', { path });
  if (stat.size > HTML_ARTIFACT_MAX_BYTES) return artifactTooLarge(path, stat.size);
  const read = await client.request<FsReadResp>('fs.read', { path, encoding: 'utf8' });
  const content = typeof read.content === 'string' ? read.content : '';
  const issues: string[] = [];

  if (stat.kind !== 'file') issues.push('path is not a file');
  if ((stat.size ?? 0) <= 0 || content.trim().length === 0) issues.push('file is empty');
  if (!/<!doctype\s+html/i.test(content) && !/<html[\s>]/i.test(content)) issues.push('missing <!doctype html> or <html> root');
  if (!/<body[\s>]/i.test(content) && !/<canvas[\s>]/i.test(content) && !/<main[\s>]/i.test(content)) {
    issues.push('missing visible body/main/canvas content');
  }

  const scriptIssues = validateInlineScripts(content);
  issues.push(...scriptIssues);

  const missingAssets = await missingLocalAssets(path, content, client);
  if (missingAssets.length > 0) {
    issues.push(`missing local assets: ${missingAssets.slice(0, 6).join(', ')}${missingAssets.length > 6 ? `, and ${missingAssets.length - 6} more` : ''}`);
  }

  if (issues.length > 0) {
    return errorOutcome(
      'invalid_html_artifact',
      `HTML artifact validation failed for ${path}: ${issues.join('; ')}.`,
      'Fix the HTML or missing asset references, then validate again.',
      { path, issues },
    );
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

function artifactTooLarge(path: string, sizeBytes: number): ToolOutcome {
  return errorOutcome(
    'artifact_too_large',
    `HTML artifact at ${path} is ${sizeBytes} bytes; the limit is ${HTML_ARTIFACT_MAX_BYTES} bytes.`,
    'Simplify or split the deliverable, then retry without writing the oversized document.',
    { path, sizeBytes, maxBytes: HTML_ARTIFACT_MAX_BYTES },
  );
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
