// Browser smoke-render gate for candidate HTML artifacts. The document is
// mounted in the same sandbox/CSP as the visible preview and reports runtime,
// rejection, and CSP failures to the parent without granting same-origin.
import {
  applyHtmlArtifactDocumentPolicy,
  HTML_ARTIFACT_IFRAME_SANDBOX,
} from '../../core/htmlArtifactPolicy';

export interface HtmlArtifactSmokeResult {
  ok: boolean;
  errors: string[];
}

interface SmokeMountOptions {
  html: string;
  token: string;
  onLoad: () => void;
  onDiagnostic: (message: string) => void;
}

export type HtmlArtifactSmokeMount = (options: SmokeMountOptions) => () => void;

export async function smokeRenderHtmlArtifact(
  html: string,
  options: {
    signal?: AbortSignal;
    timeoutMs?: number;
    settleMs?: number;
    mount?: HtmlArtifactSmokeMount;
  } = {},
): Promise<HtmlArtifactSmokeResult> {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const settleMs = options.settleMs ?? 75;
  const token = `artifact-smoke-${crypto.randomUUID()}`;
  const errors: string[] = [];

  return await new Promise(resolve => {
    let finished = false;
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = (extra?: string): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timeoutTimer);
      if (settleTimer) clearTimeout(settleTimer);
      options.signal?.removeEventListener('abort', onAbort);
      cleanup();
      if (extra) errors.push(extra);
      resolve({ ok: errors.length === 0, errors });
    };
    const onAbort = (): void => finish('Smoke render cancelled.');
    const mount = options.mount ?? mountSandboxedArtifact;
    const cleanup = mount({
      html,
      token,
      onDiagnostic: message => { if (!errors.includes(message)) errors.push(message); },
      onLoad: () => {
        settleTimer = setTimeout(() => finish(), settleMs);
      },
    });
    const timeoutTimer = setTimeout(() => finish('Smoke render timed out.'), timeoutMs);
    options.signal?.addEventListener('abort', onAbort, { once: true });
    if (options.signal?.aborted) onAbort();
  });
}

function mountSandboxedArtifact(options: SmokeMountOptions): () => void {
  if (typeof document === 'undefined' || typeof window === 'undefined' || !document.body) {
    queueMicrotask(() => options.onDiagnostic('Smoke render is unavailable in this runtime.'));
    queueMicrotask(options.onLoad);
    return () => {};
  }
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', HTML_ARTIFACT_IFRAME_SANDBOX);
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;width:1px;height:1px;left:-10000px;top:-10000px;visibility:hidden;';
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== iframe.contentWindow) return;
    const data = event.data as { token?: unknown; message?: unknown } | null;
    if (!data || data.token !== options.token || typeof data.message !== 'string') return;
    options.onDiagnostic(data.message);
  };
  window.addEventListener('message', onMessage);
  iframe.addEventListener('load', options.onLoad, { once: true });
  iframe.srcdoc = instrumentHtmlForSmokeRender(options.html, options.token);
  document.body.appendChild(iframe);
  return () => {
    window.removeEventListener('message', onMessage);
    iframe.remove();
  };
}

export function instrumentHtmlForSmokeRender(html: string, token: string): string {
  const protectedHtml = applyHtmlArtifactDocumentPolicy(html);
  if (typeof DOMParser === 'undefined') return protectedHtml;
  const doc = new DOMParser().parseFromString(protectedHtml, 'text/html');
  const reporter = doc.createElement('script');
  reporter.textContent = `(() => {
    const report = message => parent.postMessage({ token: ${JSON.stringify(token)}, message: String(message) }, '*');
    addEventListener('error', event => report(event.message || 'Uncaught artifact error'));
    addEventListener('unhandledrejection', event => report('Unhandled rejection: ' + (event.reason?.message || event.reason || 'unknown')));
    addEventListener('securitypolicyviolation', event => report('CSP violation: ' + event.violatedDirective + (event.blockedURI ? ' (' + event.blockedURI + ')' : '')));
  })();`;
  const firstPolicy = doc.head.querySelector('meta[http-equiv="Content-Security-Policy"]');
  firstPolicy?.after(reporter);
  if (!firstPolicy) doc.head.prepend(reporter);
  const doctype = doc.doctype ? `<!doctype ${doc.doctype.name}>\n` : '';
  return `${doctype}${doc.documentElement.outerHTML}`;
}
