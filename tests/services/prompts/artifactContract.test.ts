import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_CONTRACT_VERSION,
  appendArtifactContractPrompt,
  artifactContractPrompt,
} from '../../../src/services/prompts/artifactContract';
import {
  HTML_ARTIFACT_DOCUMENT_CSP,
  HTML_ARTIFACT_MAX_BYTES,
  HTML_ARTIFACT_WARN_BYTES,
} from '../../../src/core/htmlArtifactPolicy';

describe('HTML artifact prompt contract', () => {
  it('renders the deliberate version and shared preview/size policy', () => {
    expect(ARTIFACT_CONTRACT_VERSION).toBe(1);
    expect(artifactContractPrompt()).toMatchInlineSnapshot(`
      "HTML artifact contract v1:
      - Produce one self-contained HTML document. Inline CSS, JavaScript, fonts, and media; do not depend on external network requests.
      - Preview policy: ${HTML_ARTIFACT_DOCUMENT_CSP}
      - Keep content at or below ${HTML_ARTIFACT_MAX_BYTES} bytes. Content over ${HTML_ARTIFACT_WARN_BYTES} bytes is accepted with a warning; larger content is rejected before any write.
      - Create once, then revise in place by reusing the artifact id. Never create a second artifact merely to fix the first.
      - Use the artifact tool to create, update, list, and validate finished HTML deliverables."
    `);
  });

  it('only appends the contract when the artifact tool is enabled', () => {
    expect(appendArtifactContractPrompt('base', [{ name: 'artifact' }])).toContain('HTML artifact contract v1');
    expect(appendArtifactContractPrompt('base', [{ name: 'fs' }])).toBe('base');
    expect(appendArtifactContractPrompt(undefined, [{ name: 'artifact' }])).toBe(artifactContractPrompt());
  });
});
