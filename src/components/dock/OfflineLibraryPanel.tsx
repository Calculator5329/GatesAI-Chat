import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';

import type { OfflineLibraryBenchmarkCell, OfflineLibraryBenchmarkSummary } from '../../core/offlineLibrary';
import { useOfflineLibraryStore } from '../../stores/context';
import type { DockPanelProps } from './panelRegistry';

const EMPTY_BENCHMARK_CELLS: OfflineLibraryBenchmarkCell[] = [];

export const OfflineLibraryPanel = observer(function OfflineLibraryPanel(_props: DockPanelProps) {
  const addon = useOfflineLibraryStore();
  const arena = addon.knowledgeArena;
  const [model, setModel] = useState('');
  const [strategy, setStrategy] = useState('');
  const cells = arena?.cells ?? EMPTY_BENCHMARK_CELLS;
  const models = useMemo(() => unique(cells.map(cell => cell.model)), [cells]);
  const strategies = useMemo(() => unique(cells.map(cell => cell.strategy)), [cells]);
  const filtered = cells
    .filter(cell => (!model || cell.model === model) && (!strategy || cell.strategy === strategy))
    .sort((left, right) => right.averageScore - left.averageScore)
    .slice(0, 40);

  if (!addon.enabled) return <PanelNotice>Enable Offline Library in Settings to inspect local benchmarks.</PanelNotice>;
  if (addon.phase !== 'healthy') return <PanelNotice>{addon.statusLabel}</PanelNotice>;
  if (!arena) return <PanelNotice>{addon.detailsError ?? 'Benchmark summary is unavailable.'}</PanelNotice>;
  if (!arena.available) return <PanelNotice>{arena.reason ?? 'No benchmark run is available.'}</PanelNotice>;

  const run = arena.run ?? {};
  return (
    <div className="offline-library-panel" data-testid="offline-library-panel">
      <div className="offline-library-panel__eyebrow">LOCAL · READ ONLY</div>
      <div className="offline-library-panel__run">
        <strong>{stringValue(run, 'name') ?? 'Knowledge Arena'}</strong>
        <span>{numberValue(run, 'trials')} trials · {numberValue(run, 'cells')} cells · {numberValue(run, 'errors')} errors</span>
        <span>{addon.sources?.sources.length ?? 0} public/offline sources · no remote fallback</span>
      </div>

      <div className="offline-library-panel__controls">
        <label>Model
          <select value={model} onChange={event => setModel(event.target.value)}>
            <option value="">All models</option>
            {models.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>Setup
          <select value={strategy} onChange={event => setStrategy(event.target.value)}>
            <option value="">All setups</option>
            {strategies.map(value => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>

      <SummaryStrip title="Models" rows={arena.summaries?.model ?? []} />
      <SummaryStrip title="Retrieval setups" rows={arena.summaries?.strategy ?? []} />

      <div className="offline-library-panel__section-title">Model × setup cells</div>
      <div className="offline-library-panel__cells">
        {filtered.map(cell => <BenchmarkCell key={`${cell.model}:${cell.strategy}:${cell.task_id}:${cell.dataset}`} cell={cell} />)}
        {filtered.length === 0 && <PanelNotice>No cells match these filters.</PanelNotice>}
      </div>
      <div className="offline-library-panel__footnote">
        Citation values are URI-grounding proxies, not factual hallucination judgments. No raw answers or evidence passages are shown.
      </div>
    </div>
  );
});

function SummaryStrip({ title, rows }: { title: string; rows: OfflineLibraryBenchmarkSummary[] }) {
  return (
    <section className="offline-library-panel__summary">
      <div className="offline-library-panel__section-title">{title}</div>
      {rows.slice(0, 8).map(row => (
        <div className="offline-library-panel__summary-row" key={row.name}>
          <span title={row.name}>{row.name}</span>
          <div className="offline-library-panel__bar"><i style={{ width: `${Math.max(0, Math.min(100, row.averageScore))}%` }} /></div>
          <strong>{row.averageScore.toFixed(1)}</strong>
        </div>
      ))}
    </section>
  );
}

function BenchmarkCell({ cell }: { cell: OfflineLibraryBenchmarkCell }) {
  return (
    <article className="offline-library-panel__cell">
      <div className="offline-library-panel__cell-head">
        <strong>{cell.model}</strong><span>{cell.strategy}</span><b>{cell.averageScore.toFixed(1)}</b>
      </div>
      <div>{cell.dataset} · {cell.trials} trials · 95% CI {cell.scoreConfidence95.low.toFixed(1)}–{cell.scoreConfidence95.high.toFixed(1)}</div>
      <div>Source {percent(cell.sourceHitRate)} · terms {percent(cell.averageTermRecall)} · citations {percent(cell.citationValidityRate)}</div>
      <div>Retrieve {Math.round(cell.averageRetrievalLatencyMs)} ms · generate {Math.round(cell.averageGenerationLatencyMs)} ms</div>
    </article>
  );
}

function PanelNotice({ children }: { children: string }) {
  return <div className="dock-panel__notice">{children}</div>;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function stringValue(record: Record<string, unknown>, key: string): string | null {
  return typeof record[key] === 'string' ? record[key] : null;
}

function numberValue(record: Record<string, unknown>, key: string): number {
  return typeof record[key] === 'number' && Number.isFinite(record[key]) ? record[key] : 0;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
