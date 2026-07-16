import { describe, expect, it } from 'vitest';
import {
  applyHtmlArtifactDocumentPolicy,
  HTML_ARTIFACT_DOCUMENT_CSP,
} from '../../src/core/htmlArtifactPolicy';

describe('HTML artifact document policy', () => {
  it('injects the canonical CSP first in an existing head', () => {
    const html = applyHtmlArtifactDocumentPolicy('<!doctype html><html><head><title>x</title></head><body>x</body></html>');
    expect(html).toContain(`<head><meta http-equiv="Content-Security-Policy" content="${HTML_ARTIFACT_DOCUMENT_CSP}"><title>x</title>`);
    expect(HTML_ARTIFACT_DOCUMENT_CSP).toContain("connect-src 'none'");
    expect(HTML_ARTIFACT_DOCUMENT_CSP).toContain("frame-src 'none'");
  });

  it('creates a head when the document omitted one', () => {
    const html = applyHtmlArtifactDocumentPolicy('<html><body>hello</body></html>');
    expect(html).toMatch(/^<html><head><meta http-equiv="Content-Security-Policy"/);
  });
});
