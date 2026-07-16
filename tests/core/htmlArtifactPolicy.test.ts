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
    const source = '<!-- <head> decoy --><html><head><script>const text = "<head>";</script></head><body>x</body></html>';
    const html = applyHtmlArtifactDocumentPolicy(source);
    const doc = new DOMParser().parseFromString(html, 'text/html');

    expect(doc.head.firstElementChild?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(doc.head.querySelector('script')?.textContent).toContain('"<head>"');
  });

  it('fails closed when DOMParser is unavailable', () => {
    vi.stubGlobal('DOMParser', undefined);
    const source = '<script>fetch("https://example.com")</script>';
    const html = applyHtmlArtifactDocumentPolicy(source);

    expect(html).toContain('Content-Security-Policy');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain(source);
  });
});
