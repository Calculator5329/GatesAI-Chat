import { describe, expect, it } from 'vitest';
import {
  instrumentHtmlForSmokeRender,
  smokeRenderHtmlArtifact,
} from '../../../src/services/artifacts/smokeRender';

describe('HTML artifact smoke render', () => {
  it('places its diagnostic reporter before candidate scripts', () => {
    const html = instrumentHtmlForSmokeRender(
      '<!doctype html><html><head><script>throw new Error("boom")</script></head><body>x</body></html>',
      'token-1',
    );
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const children = Array.from(doc.head.children);

    expect(children[0]?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(children[1]?.textContent).toContain('token-1');
    expect(children[2]?.textContent).toContain('throw new Error("boom")');
  });

  it('fails when the sandbox reports a throwing artifact', async () => {
    const result = await smokeRenderHtmlArtifact('<script>throw new Error("boom")</script>', {
      settleMs: 0,
      mount: ({ onDiagnostic, onLoad }) => {
        onDiagnostic('Uncaught Error: boom');
        onLoad();
        return () => {};
      },
    });

    expect(result).toEqual({ ok: false, errors: ['Uncaught Error: boom'] });
  });
});
