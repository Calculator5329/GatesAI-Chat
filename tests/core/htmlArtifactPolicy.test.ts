import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyHtmlArtifactDocumentPolicy,
  HTML_ARTIFACT_DOCUMENT_CSP,
} from '../../src/core/htmlArtifactPolicy';

describe('HTML artifact document policy', () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it('ignores head decoys in comments and scripts and prepends the parsed policy', () => {
    const source = '<!-- <head> decoy --><!doctype html><html><head><script>const marker = "<head>"; fetch("https://example.com")</script></head><body>x</body></html>';
    const html = applyHtmlArtifactDocumentPolicy(source);
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const firstHeadElement = doc.head.firstElementChild;

    expect(firstHeadElement?.tagName).toBe('META');
    expect(firstHeadElement?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(firstHeadElement?.getAttribute('content')).toBe(HTML_ARTIFACT_DOCUMENT_CSP);
    expect(doc.head.querySelector('script')?.textContent).toContain('fetch("https://example.com")');
  });

  it('fails closed to escaped source when DOM parsing is unavailable', () => {
    vi.stubGlobal('DOMParser', undefined);
    const html = applyHtmlArtifactDocumentPolicy('<script>fetch("https://example.com")</script>');

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});
