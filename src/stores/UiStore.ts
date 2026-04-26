import { autorun, makeAutoObservable, runInAction, toJS } from 'mobx';
import type {
  AccentKey,
  BgKey,
  CodeSizeKey,
  CodeStyleKey,
  DraftAttachment,
  HeaderKey,
  MarkdownDensityKey,
  MarkdownStyleKey,
  SendKey,
  ThreadHeaderKey,
  ToolCallStyleKey,
} from '../core/types';
import { loadUiPrefs, saveUiPrefs } from '../services/uiPrefsStorage';
import type { BridgeStore } from './BridgeStore';

/**
 * Owns ephemeral UI state: theme keys + composer draft.
 * Surface routing (chat vs menu, which menu section) lives in RouterStore.
 *
 * Most fields here are intentionally not persisted — theme is "tuning"
 * that should reset cleanly. The `toolCallStyle` pick is the exception:
 * users want set-and-forget for that one, so it round-trips through
 * `gatesai.uiprefs.v1`.
 */
export class UiStore {
  draft = '';
  attachments: DraftAttachment[] = [];
  /** True while at least one file from the most recent drop / picker is in flight. */
  uploading = false;
  /** Last upload error message. Cleared on each new upload attempt. */
  uploadError: string | null = null;

  bgKey: BgKey = 'charcoal';
  accentKey: AccentKey = 'emerald';
  headerKey: HeaderKey = 'wordmark';
  sendKey: SendKey = 'ghost';
  threadHeaderKey: ThreadHeaderKey = 'none';

  toolCallStyle: ToolCallStyleKey = 'aside';
  markdownStyle: MarkdownStyleKey = 'compact';
  codeStyle: CodeStyleKey = 'obsidian';
  markdownDensity: MarkdownDensityKey = 'compact';
  codeSize: CodeSizeKey = 'medium';

  constructor() {
    const prefs = loadUiPrefs();
    this.toolCallStyle = prefs.toolCallStyle;
    this.markdownStyle = prefs.markdownStyle;
    this.codeStyle = prefs.codeStyle;
    this.markdownDensity = prefs.markdownDensity;
    this.codeSize = prefs.codeSize;
    makeAutoObservable(this);
    autorun(() => saveUiPrefs(toJS({
      toolCallStyle: this.toolCallStyle,
      markdownStyle: this.markdownStyle,
      codeStyle: this.codeStyle,
      markdownDensity: this.markdownDensity,
      codeSize: this.codeSize,
    })));
  }

  setDraft(value: string): void { this.draft = value; }
  clearDraft(): void { this.draft = ''; this.attachments = []; }

  addAttachment(att: DraftAttachment): void { this.attachments.push(att); }
  removeAttachment(id: string): void { this.attachments = this.attachments.filter(a => a.id !== id); }
  clearAttachments(): void { this.attachments = []; }

  /**
   * Sequentially upload a batch of files through the bridge and append
   * each successful result to {@link attachments}. Owns the `uploading`
   * flag and the `uploadError` message so the composer can stay a thin
   * presentational shell.
   */
  async uploadFiles(files: FileList | File[], bridge: BridgeStore): Promise<void> {
    runInAction(() => { this.uploadError = null; });
    if (!bridge.isOnline) {
      runInAction(() => { this.uploadError = 'Bridge offline. Start gatesai-bridge to attach files.'; });
      return;
    }
    runInAction(() => { this.uploading = true; });
    try {
      for (const f of Array.from(files)) {
        const att = await bridge.uploadAttachment(f);
        runInAction(() => { this.attachments.push(att); });
      }
    } catch (err) {
      const message = (err as Error).message;
      runInAction(() => { this.uploadError = message; });
    } finally {
      runInAction(() => { this.uploading = false; });
    }
  }

  setToolCallStyle(value: ToolCallStyleKey): void { this.toolCallStyle = value; }
  setMarkdownStyle(value: MarkdownStyleKey): void { this.markdownStyle = value; }
  setCodeStyle(value: CodeStyleKey): void { this.codeStyle = value; }
  setMarkdownDensity(value: MarkdownDensityKey): void { this.markdownDensity = value; }
  setCodeSize(value: CodeSizeKey): void { this.codeSize = value; }
}
