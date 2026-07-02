// Owns observable UiStore state and actions for the app runtime.
// Called by RootStore, React context hooks, and service callbacks; depends on services/core contracts.
// Invariant: mutations happen through store actions so UI derivations stay consistent.
import { action, autorun, makeAutoObservable, runInAction, toJS } from 'mobx';
import { MOBILE_SHELL_QUERY } from '../core/breakpoints';
import type {
  CodeSizeKey,
  CodeStyleKey,
  DraftAttachment,
  MarkdownDensityKey,
  MarkdownStyleKey,
} from '../core/types';
import { loadUiPrefs, saveUiPrefs, type UiPrefsSnapshot } from '../services/uiPrefsStorage';
import { loadMenuHintSeen, saveMenuHintSeen } from '../services/storage/uiHintStorage';
import { logger } from '../services/diagnostics/logger';
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
  /** Thread id currently bound to {@link draft} / {@link attachments}. */
  private boundDraftThreadId: string | null = null;
  private readonly draftByThread = new Map<string, { draft: string; attachments: DraftAttachment[] }>();
  /** True while at least one file from the most recent drop / picker is in flight. */
  uploading = false;
  /** Last upload error message. Cleared on each new upload attempt. */
  uploadError: string | null = null;
  private readonly disposers: Array<() => void> = [];

  markdownStyle: MarkdownStyleKey = 'compact';
  codeStyle: CodeStyleKey = 'obsidian';
  markdownDensity: MarkdownDensityKey = 'compact';
  codeSize: CodeSizeKey = 'medium';
  bodyFontSizePx = 17;
  readingWidthPx = 720;
  animationsEnabled = true;
  /** First-run cue: pulse the brand wordmark until the user opens the menu. */
  menuHintSeen = loadMenuHintSeen();
  /**
   * True while the viewport matches {@link MOBILE_SHELL_QUERY} (fixed topbar
   * + drawer sidebar layout). Single matchMedia subscription for the app;
   * components read this instead of duplicating the CSS breakpoint in JS.
   */
  mobileShell = false;

  constructor() {
    const prefs = loadUiPrefs();
    this.markdownStyle = prefs.markdownStyle;
    this.codeStyle = prefs.codeStyle;
    this.markdownDensity = prefs.markdownDensity;
    this.codeSize = prefs.codeSize;
    this.bodyFontSizePx = prefs.bodyFontSizePx;
    this.readingWidthPx = prefs.readingWidthPx;
    this.animationsEnabled = prefs.animationsEnabled;
    makeAutoObservable<this, 'boundDraftThreadId' | 'draftByThread' | 'disposers'>(this, {
      boundDraftThreadId: false,
      draftByThread: false,
      disposers: false,
      bindDraftThread: action.bound,
      setDraft: action.bound,
      clearDraft: action.bound,
      addAttachment: action.bound,
      removeAttachment: action.bound,
      clearAttachments: action.bound,
    });
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
    this.disposers.push(autorun(() => {
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
    }));
    this.disposers.push(flushPrefs);
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', flushPrefs);
      window.addEventListener('beforeunload', flushPrefs);
      this.disposers.push(() => {
        window.removeEventListener('pagehide', flushPrefs);
        window.removeEventListener('beforeunload', flushPrefs);
      });
    }
    // jsdom test environments may lack matchMedia; default stays false there.
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const mediaQuery = window.matchMedia(MOBILE_SHELL_QUERY);
      runInAction(() => { this.mobileShell = mediaQuery.matches; });
      const handleMobileShellChange = (event: MediaQueryListEvent) => {
        runInAction(() => { this.mobileShell = event.matches; });
      };
      mediaQuery.addEventListener('change', handleMobileShellChange);
      this.disposers.push(() => mediaQuery.removeEventListener('change', handleMobileShellChange));
    }
  }

  dispose(): void {
    while (this.disposers.length > 0) this.disposers.pop()?.();
  }

  /**
   * Swap the composer draft to match `threadId`. Persists the outgoing draft
   * under the previously bound thread so unsent text does not leak across
   * conversations.
   */
  bindDraftThread(threadId: string | null): void {
    if (this.boundDraftThreadId) {
      this.draftByThread.set(this.boundDraftThreadId, {
        draft: this.draft,
        attachments: [...this.attachments],
      });
    }
    this.boundDraftThreadId = threadId;
    if (!threadId) {
      this.draft = '';
      this.attachments = [];
      return;
    }
    const saved = this.draftByThread.get(threadId);
    this.draft = saved?.draft ?? '';
    this.attachments = saved?.attachments ? [...saved.attachments] : [];
  }

  setDraft(value: string): void {
    this.draft = value;
    if (this.boundDraftThreadId) {
      const saved = this.draftByThread.get(this.boundDraftThreadId);
      this.draftByThread.set(this.boundDraftThreadId, {
        draft: value,
        attachments: saved?.attachments ? [...saved.attachments] : [...this.attachments],
      });
    }
  }

  clearDraft(): void {
    this.draft = '';
    this.attachments = [];
    if (this.boundDraftThreadId) {
      this.draftByThread.set(this.boundDraftThreadId, { draft: '', attachments: [] });
    }
  }

  addAttachment(att: DraftAttachment): void {
    this.attachments.push(att);
    if (this.boundDraftThreadId) {
      const saved = this.draftByThread.get(this.boundDraftThreadId);
      this.draftByThread.set(this.boundDraftThreadId, {
        draft: saved?.draft ?? this.draft,
        attachments: [...this.attachments],
      });
    }
  }

  removeAttachment(id: string): void {
    this.attachments = this.attachments.filter(a => a.id !== id);
    if (this.boundDraftThreadId) {
      const saved = this.draftByThread.get(this.boundDraftThreadId);
      this.draftByThread.set(this.boundDraftThreadId, {
        draft: saved?.draft ?? this.draft,
        attachments: [...this.attachments],
      });
    }
  }

  clearAttachments(): void {
    this.attachments = [];
    if (this.boundDraftThreadId) {
      const saved = this.draftByThread.get(this.boundDraftThreadId);
      this.draftByThread.set(this.boundDraftThreadId, {
        draft: saved?.draft ?? this.draft,
        attachments: [],
      });
    }
  }

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
      logger.warn('attachments', 'Attachment upload failed', { err });
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

  /** Record that the user has discovered the menu; suppresses the brand cue. */
  markMenuHintSeen(): void {
    if (this.menuHintSeen) return;
    this.menuHintSeen = true;
    saveMenuHintSeen();
  }

  // ── Web Lite browser-data maintenance (facade over services/storage) ──
  // These let the Settings UI inspect and clear browser-resident app data
  // without importing the storage service directly.
  localDataUsage(): LocalDataSlotUsage[] { return readLocalDataUsage(); }
  clearLocalDataExceptCredentials(): void { clearLocalDataExceptCredentials(); }
  formatBytes(bytes: number): string { return formatBytes(bytes); }
}
