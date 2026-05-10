import { useEffect, useId, useState } from 'react';

type DiagramState =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error'; reason: string };

export function MermaidDiagram({ source }: { source: string }) {
  const id = useId().replace(/:/g, '');
  const [state, setState] = useState<DiagramState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setState({ status: 'loading' });
      const mod = await import('mermaid');
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'dark',
        themeVariables: {
          background: '#080a0f',
          mainBkg: '#151922',
          primaryColor: '#151922',
          primaryTextColor: '#e7e9ee',
          primaryBorderColor: '#2a3040',
          lineColor: '#7aa2ff',
          secondaryColor: '#10141c',
          tertiaryColor: '#0d1118',
        },
      });
      const rendered = await mermaid.render(`mermaid-${id}`, source);
      if (!cancelled) setState({ status: 'ready', svg: rendered.svg });
    })().catch(error => {
      if (!cancelled) setState({ status: 'error', reason: error instanceof Error ? error.message : 'Could not render diagram.' });
    });
    return () => { cancelled = true; };
  }, [id, source]);

  if (state.status === 'ready') {
    return (
      <div
        className="mermaid-diagram"
        aria-label="Mermaid diagram"
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
    );
  }

  return (
    <pre className="mermaid-diagram mermaid-diagram--fallback">
      <code>{state.status === 'loading' ? 'Rendering diagram...' : `Diagram render failed: ${state.reason}\n\n${source}`}</code>
    </pre>
  );
}
