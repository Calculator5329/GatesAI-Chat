// Owns observable UiStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { autorun, makeAutoObservable, runInAction, toJS } from 'mobx';
import type {
  CodeSizeKey,
  CodeStyleKey,
  DraftAttachment,
  MarkdownDensityKey,
  MarkdownStyleKey,
} from '../core/types';
import { loadUiPrefs, saveUiPrefs, type UiPrefsSnapshot } from '../services/uiPrefsStorage';
import {
  clearLocalDataExceptCredentials,
  formatBytes,
  readLocalDataUsage,
  type LocalDataSlotUsage,
} from '../services/storage/webLiteLocalData';
import type { BridgeStore } from './BridgeStore';

export type { LocalDataSlotUsage } from '../services/storage/webLiteLocalData';

/**
 * Owns ephemeral UI state: composer draft and reading preferences.
 * Surface routing (chat vs menu, which menu section) lives in RouterStore.
 */
export class UiStore {
  draft = '';
  attachments: DraftAttachment[] = [];
  /** True while at least one file from the most recent drop / picker is in flight. */
  uploading = false;
  /** Last upload error message. Cleared on each new upload attempt. */
  uploadError: string | null = null;

  markdownStyle: MarkdownStyleKey = 'compact';
  codeStyle: CodeStyleKey = 'obsidian';
  markdownDensity: MarkdownDensityKey = 'compact';
  codeSize: CodeSizeKey = 'medium';
  bodyFontSizePx = 17;
  readingWidthPx = 720;
  animationsEnabled = true;

  constructor() {
    const prefs = loadUiPrefs();
    this.markdownStyle = prefs.markdownStyle;
    this.codeStyle = prefs.codeStyle;
    this.markdownDensity = prefs.markdownDensity;
    this.codeSize = prefs.codeSize;
    this.bodyFontSizePx = prefs.bodyFontSizePx;
    this.readingWidthPx = prefs.readingWidthPx;
    this.animationsEnabled = prefs.animationsEnabled;
    makeAutoObservable(this);
    // Debounce UI-prefs persistence: a slider drag (font size, reading width)
    // can fire dozens of mutations per second; without debouncing each one
    // would JSON.stringify + write to localStorage on the main thread.
    // Trailing 500ms debounce coalesces a drag into one write. We flush on
    // pagehide/beforeunload so a tab close mid-debounce doesn't lose the
    // final value.
    const DEBOUNCE_MS = 500;
    let pendingPrefs: UiPrefsSnapshot | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPrefs = (): void => {
      if (pendingTimer) { clearTimeout(pendingTimer); pendingTimer = null; }
      if (pendingPrefs) {
        saveUiPrefs(pendingPrefs);
        pendingPrefs = null;
      }
    };
    autorun(() => {
      pendingPrefs = toJS({
        markdownStyle: this.markdownStyle,
        codeStyle: this.codeStyle,
        markdownDensity: this.markdownDensity,
        codeSize: this.codeSize,
        bodyFontSizePx: this.bodyFontSizePx,
        readingWidthPx: this.readingWidthPx,
        animationsEnabled: this.animationsEnabled,
      });
      if (pendingTimer) clearTimeout(pendingTimer);
      pendingTimer = setTimeout(flushPrefs, DEBOUNCE_MS);
    });
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flushPrefs);
      window.addEventListener('beforeunload', flushPrefs);
    }
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

  setMarkdownStyle(value: MarkdownStyleKey): void { this.markdownStyle = value; }
  setCodeStyle(value: CodeStyleKey): void { this.codeStyle = value; }
  setMarkdownDensity(value: MarkdownDensityKey): void { this.markdownDensity = value; }
  setCodeSize(value: CodeSizeKey): void { this.codeSize = value; }
  setBodyFontSizePx(value: number): void {
    this.bodyFontSizePx = Math.max(14, Math.min(20, Math.round(value)));
  }
  setReadingWidthPx(value: number): void { this.readingWidthPx = value; }
  setAnimationsEnabled(value: boolean): void { this.animationsEnabled = value; }

  // ── Web Lite browser-data maintenance (facade over services/storage) ──
  // These let the Settings UI inspect and clear browser-resident app data
  // without importing the storage service directly.
  localDataUsage(): LocalDataSlotUsage[] { return readLocalDataUsage(); }
  clearLocalDataExceptCredentials(): void { clearLocalDataExceptCredentials(); }
  formatBytes(bytes: number): string { return formatBytes(bytes); }
}
