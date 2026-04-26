import { observer } from 'mobx-react-lite';
import { useOpenRouterStore } from '../../../../stores/context';
import { Button } from '../../../ui';

function formatTimestamp(ts: number | null): string {
  if (!ts) return 'never';
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
}

export const OpenRouterCatalogRow = observer(function OpenRouterCatalogRow() {
  const store = useOpenRouterStore();
  const { count, fetchedAt, fetching, fetchError } = store;

  return (
    <div style={{
      marginTop: 12, paddingTop: 12,
      borderTop: '1px solid var(--border)',
      display: 'flex', flexDirection: 'column', gap: 6,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <div style={{ fontSize: 12.5, color: 'var(--text-dim)' }}>
            Model catalog
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--text-faint)' }}>
            {count > 0
              ? <>{count.toLocaleString()} models · last refreshed {formatTimestamp(fetchedAt)}</>
              : <>Not loaded yet — pull the live list from OpenRouter</>}
          </div>
        </div>
        <Button onClick={() => { void store.refresh(); }} disabled={fetching}>
          {fetching ? 'Refreshing…' : (count > 0 ? 'Refresh' : 'Load models')}
        </Button>
        {count > 0 && !fetching && (
          <Button variant="danger" onClick={() => store.clearCache()}>Clear</Button>
        )}
      </div>
      {fetchError && (
        <div style={{ fontSize: 11.5, color: '#e57373' }}>{fetchError}</div>
      )}
    </div>
  );
});
