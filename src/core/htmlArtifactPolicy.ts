// Canonical security and size policy for user-facing HTML artifacts.
// Shared by model instructions, creation validation, smoke rendering, and
// preview rendering so the four boundaries cannot silently drift.

export const HTML_ARTIFACT_WARN_BYTES = 256 * 1024;
export const HTML_ARTIFACT_MAX_BYTES = 1024 * 1024;

export const HTML_ARTIFACT_IFRAME_SANDBOX =
  'allow-scripts allow-forms allow-popups allow-downloads';

export const HTML_ARTIFACT_DOCUMENT_CSP = [
  "default-src 'none'",
  "base-uri 'none'",
  "object-src 'none'",
  "script-src 'unsafe-inline' 'unsafe-eval'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'media-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
].join('; ');

/** Add the preview CSP as the first parsed head policy; later policies can only tighten it. */
export function applyHtmlArtifactDocumentPolicy(html: string): string {
  if (typeof DOMParser === 'undefined') return blockedSourceDocument(html);
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const policy = doc.createElement('meta');
  policy.setAttribute('http-equiv', 'Content-Security-Policy');
  policy.setAttribute('content', HTML_ARTIFACT_DOCUMENT_CSP);
  doc.head.prepend(policy);
  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>\n` : '';
  return `${doctype}${doc.documentElement.outerHTML}`;
}

function blockedSourceDocument(html: string): string {
  const escaped = html
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  return `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${HTML_ARTIFACT_DOCUMENT_CSP}"></head><body><pre>${escaped}</pre></body></html>`;
}
