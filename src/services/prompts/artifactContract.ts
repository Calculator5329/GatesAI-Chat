// Versioned model-facing contract for HTML artifacts. Kept separate from the
// tool schema so it can describe cross-cutting preview and revision rules.
import type { ToolDef } from '../../core/llm';
import {
  HTML_ARTIFACT_DOCUMENT_CSP,
  HTML_ARTIFACT_MAX_BYTES,
  HTML_ARTIFACT_WARN_BYTES,
} from '../../core/htmlArtifactPolicy';

export const ARTIFACT_CONTRACT_VERSION = 1;

export function artifactContractPrompt(): string {
  return [
    `HTML artifact contract v${ARTIFACT_CONTRACT_VERSION}:`,
    '- Produce one self-contained HTML document. Inline CSS, JavaScript, fonts, and media; do not depend on external network requests.',
    `- Preview policy: ${HTML_ARTIFACT_DOCUMENT_CSP}`,
    `- Keep content at or below ${HTML_ARTIFACT_MAX_BYTES} bytes. Content over ${HTML_ARTIFACT_WARN_BYTES} bytes is accepted with a warning; larger content is rejected before any write.`,
    '- Create once, then revise in place by reusing the artifact id. Never create a second artifact merely to fix the first.',
    '- Use the artifact tool to create, update, list, and validate finished HTML deliverables.',
  ].join('\n');
}

export function appendArtifactContractPrompt(
  systemPrompt: string | undefined,
  tools: Pick<ToolDef, 'name'>[] | undefined,
): string | undefined {
  if (!tools?.some(tool => tool.name === 'artifact')) return systemPrompt;
  const contract = artifactContractPrompt();
  return systemPrompt ? `${systemPrompt}\n\n${contract}` : contract;
}
