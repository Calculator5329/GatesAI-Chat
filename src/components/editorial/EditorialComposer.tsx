// The chat input composer: text entry, attachments, model picker trigger,
// context meter, and provider/route banners. Rendered by EditorialChat; reads
// RootStore via hooks and derives view state from props/hooks. This file is the
// orchestrator — it owns the draft/send pipeline and route gating, then hands
// derived state to the focused subcomponents under ./composer.
// Invariant: persisted chat state stays in stores; this surface is presentation only.
import { useCallback, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type RefObject } from 'react';
import { observer } from 'mobx-react-lite';
import { useEditorial } from '../../stores/context';
import { normalizeOpenRouterThinkingEffort, type ChatContextMode, type ChatThinkingEffort } from '../../stores/ChatStore';
import { isWebLite } from '../../core/runtime';
import { AttachmentTray } from './composer/AttachmentTray';
import { LocalImageBanner, ModelsKeyBanner, NoticeBanner, OllamaOfflineBanner } from './composer/ComposerBanners';
import { ComposerInput } from './composer/ComposerInput';
import { ComposerMeta } from './composer/ComposerMeta';
import { handleClipboardImagePaste } from './composer/composerAttachments';
import { useComposerDraft } from './composer/useComposerDraft';
import { useComposerRecall } from './composer/useComposerRecall';
import { userMessageBodies } from '../../core/threadSelectors';

interface ComposerProps {
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export const EditorialComposer = observer(function EditorialComposer({ textareaRef }: ComposerProps) {
  const { chat, ui, bridge, registry, providers, localRuntime, skills } = useEditorial();
  const [modelOpen, setModelOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const activeThread = chat.activeThread;
  const activeThreadId = activeThread?.id ?? null;
  const currentModel = registry.findById(activeThread?.modelId) ?? registry.findById(chat.defaultModelId);
  const activeSkill = skills.findById(activeThread?.skillId);
  const activeSkillLabel = activeSkill?.name ?? activeThread?.skillId ?? '';
  const webLite = isWebLite();
  const localContextMode = activeThread?.contextMode ?? (currentModel?.providerId === 'ollama' ? 'micro' : 'full');
  const thinkingEffort = normalizeOpenRouterThinkingEffort(activeThread?.thinkingEffort);

  const {
    value,
    onDraftChange: setDraftFromInput,
    flushDraft,
    cancelPendingFlush,
    replaceDraft,
    resetDraftAfterSend,
  } = useComposerDraft(ui, textareaRef);
  const recallMessages = activeThread ? userMessageBodies(activeThread) : [];
  const {
    onDraftChange: onRecallAwareDraftChange,
    onKeyDown: onRecallKeyDown,
    cancelRecall,
  } = useComposerRecall({
    threadId: activeThreadId,
    messages: recallMessages,
    value,
    replaceDraft,
  });

  const streaming = chat.isStreaming;
  const readOnly = activeThread?.readOnly === true || chat.isReadOnlyFollower;
  const streamActivity = activeThreadId ? chat.streamActivityByThread[activeThreadId] : undefined;
  const hasText = value.trim().length > 0;
  const directImageMode = currentModel?.providerId === 'local-image';
  const directImageReady = directImageMode && localRuntime.comfyReady;
  const activeProviderReady = currentModel
    ? providers.isConnected(currentModel.providerId)
    : providers.hasUsableProvider;
  const onboardingVisible =
    !ui.onboardingDismissed
    && !activeProviderReady
    && (activeThread?.messages.length ?? 0) === 0
    && !chat.threads.some(thread => thread.messages.length > 0);
  // Context-aware send gating: direct-image → Comfy health; Ollama model → Ollama
  // health; everything else → OpenRouter/provider key. Mutually exclusive banners.
  const routeBlock: 'models-key' | 'ollama-offline' | 'comfy-offline' | null = (() => {
    if (directImageMode) return directImageReady ? null : 'comfy-offline';
    if (currentModel?.providerId === 'ollama') {
      return providers.isConnected('ollama') ? null : 'ollama-offline';
    }
    if (currentModel) {
      return providers.isConnected(currentModel.providerId) ? null : 'models-key';
    }
    return 'models-key';
  })();
  const routeReady = routeBlock === null;
  // Send is enabled whenever there's text or at least one attachment. While
  // streaming, sending interrupts the in-flight reply and starts a new turn.
  // Direct-image mode is offline and only needs text; attachments are ignored
  // by the image job enqueue path.
  const canSend = !readOnly && (hasText || (!directImageMode && ui.attachments.length > 0)) && routeReady;
  const placeholder = readOnly
    ? 'Welcome tour is read-only'
    : routeReady && (activeThread?.messages.length ?? 0) === 0
    ? 'Ask your first question...'
    : 'Continue the thought...';

  const onSend = () => {
    if (readOnly || !canSend) return;
    // Cancel any pending flush; we're committing the final value now.
    cancelPendingFlush();
    chat.sendMessage(value, ui.attachments);
    cancelRecall();
    resetDraftAfterSend();
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;
    handleClipboardImagePaste(e, files => { void ui.uploadFiles(files, bridge); });
  };

  const onStop = () => {
    chat.stopStreaming();
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (readOnly) return;
    if (e.target.files) void ui.uploadFiles(e.target.files, bridge);
    e.target.value = '';
  };

  const closeModelPopover = useCallback(() => {
    setModelOpen(false);
  }, []);

  const closeSkillPopover = useCallback(() => {
    setSkillOpen(false);
  }, []);

  const toggleModelPopover = useCallback(() => {
    setModelOpen(o => !o);
  }, []);

  const toggleSkillPopover = () => {
    setSkillOpen(o => !o);
    if (!skillOpen) void skills.refresh();
  };

  const pickModel = useCallback((modelId: string) => {
    if (!activeThreadId) return;
    chat.setThreadModel(activeThreadId, modelId);
  }, [activeThreadId, chat]);

  const pickSkill = useCallback((skillId: string | undefined) => {
    if (!activeThreadId) return;
    chat.setThreadSkill(activeThreadId, skillId);
    setSkillOpen(false);
  }, [activeThreadId, chat]);

  const onContextModeChange = (mode: ChatContextMode) => {
    if (activeThread) chat.setThreadContextMode(activeThread.id, mode);
  };

  const onThinkingEffortChange = (effort: ChatThinkingEffort) => {
    if (activeThread) chat.setThreadThinkingEffort(activeThread.id, effort);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (onRecallKeyDown(e)) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSend();
    }
  };

  const sendTitle = streaming
    ? (hasText ? 'Interrupt and send' : 'Stop')
    : 'Send';

  return (
    <div
      className="editorial-composer"
      style={{ padding: '0 48px 16px', fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif' }}
    >
      <div className="editorial-composer__inner" style={{ width: 'min(750px, 70%)', margin: '0 auto', paddingTop: 4 }}>
        {/* Banner stack: route block → multi-tab conflict → compaction → per-thread error */}
        {routeBlock === 'comfy-offline' && <LocalImageBanner />}
        {routeBlock === 'ollama-offline' && <OllamaOfflineBanner />}
        {routeBlock === 'models-key' && !onboardingVisible && <ModelsKeyBanner />}
        {chat.persistenceConflict && (
          <NoticeBanner
            message={chat.persistenceConflict}
            actionLabel="Reload"
            onAction={() => chat.reloadFromStorage()}
            onDismiss={() => chat.dismissPersistenceConflict()}
          />
        )}
        {chat.activeTabNotice && (
          <div className="chat-error-banner" role="status" style={{ marginBottom: 8 }}>
            <span>{chat.activeTabNotice}</span>
          </div>
        )}
        {chat.compactionNotice && (
          <NoticeBanner
            message={chat.compactionNotice}
            onDismiss={() => chat.dismissCompactionNotice()}
          />
        )}
        {chat.lastError && (
          <div className="chat-error-banner" role="status">
            <span>{chat.lastError}</span>
            <button type="button" onClick={() => chat.clearLastError()} aria-label="Dismiss chat error">×</button>
          </div>
        )}
        <AttachmentTray
          attachments={ui.attachments}
          currentModel={currentModel}
          uploading={ui.uploading}
          uploadError={ui.uploadError}
          onRemove={id => ui.removeAttachment(id)}
        />
        <ComposerInput
          textareaRef={textareaRef}
          fileInputRef={fileInputRef}
          value={value}
          placeholder={placeholder}
          bridgeOnline={bridge.isOnline}
          readOnly={readOnly}
          streaming={streaming}
          hasText={hasText}
          canSend={canSend}
          sendTitle={sendTitle}
          onFileChange={onFileChange}
          onAttachClick={() => bridge.isOnline && fileInputRef.current?.click()}
          onDraftChange={next => onRecallAwareDraftChange(next, setDraftFromInput)}
          onFlushDraft={flushDraft}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onSend={onSend}
          onStop={onStop}
        />
        <ComposerMeta
          activeThread={activeThread}
          currentModel={currentModel}
          defaultModelId={chat.defaultModelId}
          modelOpen={modelOpen}
          onToggleModel={toggleModelPopover}
          onCloseModel={closeModelPopover}
          onPickModel={pickModel}
          webLite={webLite}
          skillOpen={skillOpen}
          onToggleSkill={toggleSkillPopover}
          onCloseSkill={closeSkillPopover}
          skills={skills.skills}
          skillsLoading={skills.loading}
          activeSkillLabel={activeSkillLabel}
          onPickSkill={pickSkill}
          localContextMode={localContextMode}
          onContextModeChange={onContextModeChange}
          thinkingEffort={thinkingEffort}
          onThinkingEffortChange={onThinkingEffortChange}
          draftText={value}
          streaming={streaming}
          hasText={hasText}
          streamActivity={streamActivity}
        />
      </div>
    </div>
  );
});
