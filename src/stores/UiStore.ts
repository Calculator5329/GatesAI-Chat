import { autorun, makeAutoObservable, toJS } from 'mobx';
import type {
  AccentKey,
  BgKey,
  CodeSizeKey,
  CodeStyleKey,
  HeaderKey,
  MarkdownDensityKey,
  MarkdownStyleKey,
  SendKey,
  ThreadHeaderKey,
  ToolCallStyleKey,
} from '../core/types';
import { loadUiPrefs, saveUiPrefs } from '../services/uiPrefsStorage';

/**
 * Owns ephemeral UI state: theme keys + composer draft.
 * Surface routing (chat vs menu, which menu section) lives in RouterStore.
 *
 * Most fields here are intentionally not persisted — theme is "tuning"
 * that should reset cleanly. The `toolCallStyle` pick is the exception:
 * users want set-and-forget for that one, so it round-trips through
 * `gatesai.uiprefs.v1`.
 */
/**
 * One file the user has staged for the next send. Once uploaded to the
 * bridge it carries its workspace path; the composer turns the chip set
 * into a "📎 Attached: ..." footer on the user message at send time so
 * the model has the path inline.
 */
export interface DraftAttachment {
  id: string;
  filename: string;
  /** Workspace path, e.g. `/workspace/attachments/foo.csv`. */
  path: string;
  size: number;
  mime: string;
}

export class UiStore {
  draft = '';
  attachments: DraftAttachment[] = [];

  bgKey: BgKey = 'charcoal';
  accentKey: AccentKey = 'emerald';
  headerKey: HeaderKey = 'wordmark';
  sendKey: SendKey = 'ghost';
  threadHeaderKey: ThreadHeaderKey = 'none';

  toolCallStyle: ToolCallStyleKey = 'whisper';
  markdownStyle: MarkdownStyleKey = 'editorial';
  codeStyle: CodeStyleKey = 'obsidian';
  markdownDensity: MarkdownDensityKey = 'comfortable';
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

  setToolCallStyle(value: ToolCallStyleKey): void { this.toolCallStyle = value; }
  setMarkdownStyle(value: MarkdownStyleKey): void { this.markdownStyle = value; }
  setCodeStyle(value: CodeStyleKey): void { this.codeStyle = value; }
  setMarkdownDensity(value: MarkdownDensityKey): void { this.markdownDensity = value; }
  setCodeSize(value: CodeSizeKey): void { this.codeSize = value; }
}
