import type { Thread } from '../../core/types';
import type { RagSourceSnapshot } from './indexer';

export interface RagSourceRepositoryDeps {
  getCurrent(): RagSourceSnapshot;
  listArchivedThreads(): Promise<Thread[]>;
}

/**
 * Joins the synchronous hot/stub snapshot with the archive tier without
 * mutating or hydrating ChatStore. Only records represented by current stubs
 * are retained, so orphaned IndexedDB rows never become memories.
 */
export class RagSourceRepository {
  private readonly getCurrent: () => RagSourceSnapshot;
  private readonly listArchivedThreads: () => Promise<Thread[]>;

  constructor(deps: RagSourceRepositoryDeps) {
    this.getCurrent = deps.getCurrent;
    this.listArchivedThreads = deps.listArchivedThreads;
  }

  async load(): Promise<RagSourceSnapshot> {
    const current = this.getCurrent();
    const archivedIds = new Set(current.threads.filter(thread => thread.archived).map(thread => thread.id));
    if (archivedIds.size === 0) return current;

    const archived = await this.listArchivedThreads();
    const archivedById = new Map(archived
      .filter(thread => archivedIds.has(thread.id) && thread.deletedAt == null)
      .map(thread => [thread.id, thread]));
    const threads = current.threads
      .filter(thread => thread.deletedAt == null)
      .map(thread => {
        if (!thread.archived || thread.messages.length > 0) return thread;
        return archivedById.get(thread.id) ?? thread;
      });
    return { threads, notes: current.notes, facts: current.facts, ...(current.library ? { library: current.library } : {}) };
  }
}
