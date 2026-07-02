// Coordinates best-effort conversation auto-naming outside ChatStore.
// Called after a turn finishes; depends on the existing cheap-model title cascade.
// Invariant: never overwrite a user/tool title or rename a soft-deleted thread.
import type { AssistantMessage, Thread } from '../../core/types';
import {
  generateThreadTitle,
  type ThreadTitleRouter,
} from '../threadNamer';
import { logger } from '../diagnostics/logger';

export interface AutoNameRouter extends ThreadTitleRouter {
  canRoute(): boolean;
}

export interface AutoNameHost {
  getThread(threadId: string): Thread | undefined;
  setThreadNaming(threadId: string, naming: boolean): void;
  applyThreadTitle(threadId: string, title: string): void;
}

export interface AutoNamerDeps {
  host: AutoNameHost;
  router: AutoNameRouter;
}

export class AutoNamer {
  private readonly host: AutoNameHost;
  private readonly router: AutoNameRouter;

  constructor(deps: AutoNamerDeps) {
    this.host = deps.host;
    this.router = deps.router;
  }

  /**
   * Fire-and-forget auto-name on the first successful turn. The caller must
   * have already verified stream ownership before finalizing the turn; by the
   * time this runs, streaming bookkeeping may already be cleared.
   */
  maybeAutoName(threadId: string, assistantMessage: AssistantMessage): void {
    const thread = this.host.getThread(threadId);
    if (!thread || thread.autoNamed || thread.naming || thread.deletedAt != null) return;
    if (!this.router.canRoute()) return;
    const opener = thread.messages.find(message => message.role === 'user');
    if (!opener) return;

    const assistantText = assistantMessage.content.replace(/\n\n_Error:[^]*$/s, '').trim();
    this.host.setThreadNaming(threadId, true);

    void generateThreadTitle(
      {
        userText: opener.content,
        assistantText,
        fallbackModelId: thread.modelId,
      },
      this.router,
    ).then(title => {
      this.host.setThreadNaming(threadId, false);
      const latest = this.host.getThread(threadId);
      if (title && latest && !latest.autoNamed && latest.deletedAt == null) {
        this.host.applyThreadTitle(threadId, title);
      }
    }).catch(err => {
      logger.warn('chat', 'auto-naming failed; keeping fallback title', err);
      this.host.setThreadNaming(threadId, false);
    });
  }
}
