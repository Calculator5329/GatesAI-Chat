// Canonical security and size policy for user-facing HTML artifacts.
// Shared by model instructions, creation validation, and preview rendering so
// the three boundaries cannot silently drift.

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

/** Add the preview CSP as the first head policy; later policies can only tighten it. */
export function applyHtmlArtifactDocumentPolicy(html: string): string {
  const policy = `<meta http-equiv="Content-Security-Policy" content="${HTML_ARTIFACT_DOCUMENT_CSP}">`;
  const head = /<head(?:\s[^>]*)?>/i.exec(html);
  if (head?.index != null) {
    const offset = head.index + head[0].length;
    return `${html.slice(0, offset)}${policy}${html.slice(offset)}`;
  }
  const htmlRoot = /<html(?:\s[^>]*)?>/i.exec(html);
  if (htmlRoot?.index != null) {
    const offset = htmlRoot.index + htmlRoot[0].length;
    return `${html.slice(0, offset)}<head>${policy}</head>${html.slice(offset)}`;
  }
  return `<head>${policy}</head>${html}`;
}
