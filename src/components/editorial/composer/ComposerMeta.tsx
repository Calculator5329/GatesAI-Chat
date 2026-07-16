// The composer meta row beneath the input: model picker, workspace-skill
// picker (desktop only), the per-provider context/thinking selects, the
// context-usage meter, and the streaming status label. Presentational — the
// active model/thread/skill state and mutation callbacks come from
// EditorialComposer; ContextMeter keeps its own observer for token/spend.
import { lazy, Suspense } from 'react';
import { Icons } from '../../ui/icons';
import {
  OPENROUTER_THINKING_PRESETS,
  type ChatContextMode,
  type ChatThinkingEffort,
} from '../../../stores/ChatStore';
import type { Model, StreamActivity, Thread } from '../../../core/types';
import type { WorkspaceSkill } from '../../../stores/SkillsStore';
import { tokens } from '../../../core/styleTokens';
import { ACCENT_DOT_STYLE, LOCAL_CONTEXT_SELECT_STYLE, META_ROW_STYLE, MODEL_LABEL_STYLE, SEP_STYLE } from './composerStyles';
import { ContextMeter } from './ContextMeter';
import { SkillPopover } from './SkillPopover';
import { streamStatusCopy } from '../../../core/streamStatusCopy';
// Lazy: the picker is a large surface (sections/badges/filter logic) that most
// sessions never open before first paint; splitting it trims the main chunk.
const ModelPopover = lazy(() => import('../ModelPopover'));

interface ComposerMetaProps {
  activeThread: Thread | null;
  currentModel: Model | undefined;
  defaultModelId: string;
  modelOpen: boolean;
  onToggleModel: () => void;
  onCloseModel: () => void;
  onPickModel: (modelId: string) => void;
  webLite: boolean;
  skillOpen: boolean;
  onToggleSkill: () => void;
  onCloseSkill: () => void;
  skills: WorkspaceSkill[];
  skillsLoading: boolean;
  activeSkillLabel: string;
  onPickSkill: (skillId: string | undefined) => void;
  localContextMode: ChatContextMode;
  onContextModeChange: (mode: ChatContextMode) => void;
  thinkingEffort: ChatThinkingEffort;
  onThinkingEffortChange: (effort: ChatThinkingEffort) => void;
  draftText: string;
  streaming: boolean;
  hasText: boolean;
  streamActivity: StreamActivity | undefined;
}

export function ComposerMeta({
  activeThread,
  currentModel,
  defaultModelId,
  modelOpen,
  onToggleModel,
  onCloseModel,
  onPickModel,
  webLite,
  skillOpen,
  onToggleSkill,
  onCloseSkill,
  skills,
  skillsLoading,
  activeSkillLabel,
  onPickSkill,
  localContextMode,
  onContextModeChange,
  thinkingEffort,
  onThinkingEffortChange,
  draftText,
  streaming,
  hasText,
  streamActivity,
}: ComposerMetaProps) {
  return (
    <div className="editorial-composer__meta" style={META_ROW_STYLE}>
      <div style={{ position: 'relative' }}>
        <button
          type="button"
          className="composer-model-label"
          aria-haspopup="listbox"
          aria-expanded={modelOpen}
          aria-label={`Model: ${currentModel?.name ?? 'Select model'}`}
          onClick={onToggleModel}
          onKeyDown={e => {
            if (e.key === 'Escape') onCloseModel();
          }}
          style={{ ...MODEL_LABEL_STYLE, border: 'none', background: 'transparent', font: 'inherit' }}
        >
          <span style={ACCENT_DOT_STYLE} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {currentModel?.name ?? 'Select model'}
          </span>
          <Icons.Chevron />
        </button>
        {modelOpen && activeThread && (
          <Suspense fallback={null}>
            <ModelPopover
              currentModelId={currentModel?.id ?? defaultModelId}
              onPick={onPickModel}
              onClose={onCloseModel}
            />
          </Suspense>
        )}
      </div>
      {!webLite && activeThread && (
        <div style={{ position: 'relative' }}>
          <button
            type="button"
            className="composer-skill-label"
            aria-haspopup="listbox"
            aria-expanded={skillOpen}
            aria-label={activeSkillLabel ? `Skill: ${activeSkillLabel}` : 'Skill: No skill'}
            onClick={onToggleSkill}
            onKeyDown={e => {
              if (e.key === 'Escape') onCloseSkill();
            }}
            title="Workspace skill"
            style={{ ...MODEL_LABEL_STYLE, maxWidth: 180, border: 'none', background: 'transparent', font: 'inherit' }}
          >
            <span style={{ color: 'var(--text-faint)', display: 'flex' }}><Icons.Brain /></span>
            {activeSkillLabel && (
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeSkillLabel}
              </span>
            )}
            <Icons.Chevron />
          </button>
          {skillOpen && (
            <SkillPopover
              skills={skills}
              loading={skillsLoading}
              activeSkillId={activeThread.skillId}
              onPick={onPickSkill}
              onClose={onCloseSkill}
            />
          )}
        </div>
      )}
      {/* Local context / thinking controls stay tucked away until the
          composer is hovered or focused, then slide out (see .composer-reveal
          in index.css). On touch devices the reveal media query never
          matches, so they remain visible. */}
      {activeThread && currentModel?.providerId === 'ollama' && (
        <span className="composer-reveal">
          <span style={SEP_STYLE}>·</span>
          <select
            className="composer-local-select"
            value={localContextMode}
            onChange={e => onContextModeChange(e.currentTarget.value as ChatContextMode)}
            title="Local context mode"
            style={LOCAL_CONTEXT_SELECT_STYLE}
          >
            <option value="full">full context</option>
            <option value="system-tools">system + tools</option>
            <option value="bare">bare prompt</option>
            <option value="micro">micro tools</option>
          </select>
        </span>
      )}
      {activeThread && currentModel?.providerId === 'openrouter' && (
        <span className="composer-reveal">
          <span style={SEP_STYLE}>·</span>
          <select
            className="composer-local-select"
            value={thinkingEffort}
            onChange={e => onThinkingEffortChange(e.currentTarget.value as ChatThinkingEffort)}
            title="Thinking effort"
            style={LOCAL_CONTEXT_SELECT_STYLE}
          >
            {OPENROUTER_THINKING_PRESETS.map(preset => (
              <option key={preset.value} value={preset.value} title={preset.title}>
                thinking {preset.label}
              </option>
            ))}
          </select>
        </span>
      )}
      <span className="composer-meta__sep" style={{ color: 'var(--accent)', opacity: 0.5, flex: 'none' }}>·</span>
      <ContextMeter draftText={draftText} />
      <span
        className="composer-stream-label"
        aria-live="polite"
        style={{
        marginLeft: 'auto',
        flex: 'none',
        fontFamily: '"Geist Mono", monospace',
        color: 'var(--accent)',
        opacity: streaming ? 0.85 : 0,
        transition: `opacity ${tokens.motion.fade}`,
        letterSpacing: '0.06em',
        minHeight: 18,
        minWidth: '20ch',
        textAlign: 'right',
        whiteSpace: 'nowrap',
      }}>
        {streaming ? (hasText ? 'Enter to interrupt' : streamFooterLabel(streamActivity)) : ''}
      </span>
    </div>
  );
}

export function streamFooterLabel(activity: StreamActivity | undefined): string {
  return streamStatusCopy({
    phase: activity?.phase ?? 'streaming',
    providerId: activity?.providerId,
    providerModelId: activity?.providerModelId,
  }).footer;
}
