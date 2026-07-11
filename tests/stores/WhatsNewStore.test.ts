import { describe, expect, it } from 'vitest';
import { WhatsNewStore } from '../../src/stores/WhatsNewStore';
import type { PersistenceProvider } from '../../src/services/storage/persistenceProvider';
import type { WhatsNewSnapshot } from '../../src/services/storage/whatsNewStorage';

function memoryPersistence(initial: WhatsNewSnapshot = {}): PersistenceProvider<WhatsNewSnapshot> & { saved: WhatsNewSnapshot[] } {
  let value = initial;
  const saved: WhatsNewSnapshot[] = [];
  return {
    saved,
    load: () => value,
    save: next => {
      value = next;
      saved.push(next);
    },
    clear: () => { value = {}; },
  };
}

describe('WhatsNewStore', () => {
  it('suppresses the panel on a first-ever launch and records the running version', () => {
    const persistence = memoryPersistence();

    const store = new WhatsNewStore({ version: '4.5.0', persistence });

    expect(store.isOpen).toBe(false);
    expect(persistence.saved).toEqual([{ lastSeenVersion: '4.5.0' }]);
  });

  it('opens only when the persisted version differs from the running version', () => {
    const unchanged = new WhatsNewStore({
      version: '4.5.0',
      persistence: memoryPersistence({ lastSeenVersion: '4.5.0' }),
    });
    const upgraded = new WhatsNewStore({
      version: '4.5.0',
      persistence: memoryPersistence({ lastSeenVersion: '4.4.0' }),
    });

    expect(unchanged.isOpen).toBe(false);
    expect(upgraded.isOpen).toBe(true);
    expect(upgraded.release?.version).toBe('4.5.0');
  });

  it('persists the running version when the panel is dismissed', () => {
    const persistence = memoryPersistence({ lastSeenVersion: '4.4.0' });
    const store = new WhatsNewStore({ version: '4.5.0', persistence });

    store.dismiss();

    expect(store.isOpen).toBe(false);
    expect(persistence.saved).toEqual([{ lastSeenVersion: '4.5.0' }]);
  });

  it('keeps the tour seed marker separate from version acknowledgement', () => {
    const persistence = memoryPersistence();
    const store = new WhatsNewStore({ version: '4.5.0', persistence });

    expect(store.isFirstRun).toBe(true);
    expect(store.tourThreadSeeded).toBe(false);
    store.markTourThreadSeeded();

    expect(store.tourThreadSeeded).toBe(true);
    expect(persistence.saved).toEqual([
      { lastSeenVersion: '4.5.0' },
      { lastSeenVersion: '4.5.0', tourThreadSeeded: true },
    ]);
  });
});
