// The questions the assistant is waiting on, rendered above the composer.
// Rendered by EditorialChat for the active thread; reads PromptStore.
// Invariant: every card offers a way out (decline) — a blocked tool call is
// waiting on this answer, so an unanswerable card would wedge the turn.
// Both packs render this: Aurora styles it as a card, Classic as a quiet
// panel, but the affordances are identical.
import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import type { AssistantPrompt } from '../../core/prompts';
import { usePromptStore, useUiPack } from '../../stores/context';

export const PromptCards = observer(function PromptCards({ threadId }: { threadId: string | null }) {
  const prompts = usePromptStore();
  const pack = useUiPack();
  if (!threadId) return null;
  const pending = prompts.pendingForThread(threadId);
  if (pending.length === 0) return null;
  return (
    <div className="prompt-cards" data-pack={pack} data-testid="prompt-cards">
      {pending.map(prompt => (
        <PromptCard
          key={prompt.id}
          prompt={prompt}
          onAnswer={(optionId, text) => prompts.answer(prompt.id, { optionId, text })}
          onDecline={() => prompts.decline(prompt.id)}
        />
      ))}
    </div>
  );
});

function PromptCard({
  prompt,
  onAnswer,
  onDecline,
}: {
  prompt: AssistantPrompt;
  onAnswer: (optionId: string | undefined, text: string) => void;
  onDecline: () => void;
}) {
  const [freeText, setFreeText] = useState('');
  const kindLabel = prompt.kind === 'approval' ? 'Needs your approval' : 'Suggestion';

  return (
    <section className="prompt-card" data-kind={prompt.kind} aria-label={kindLabel}>
      <header className="prompt-card__head">
        <span className="prompt-card__kind">{kindLabel}</span>
      </header>
      <h3 className="prompt-card__question">{prompt.question}</h3>
      {prompt.context && <p className="prompt-card__context">{prompt.context}</p>}
      {prompt.grounds && prompt.grounds.length > 0 && (
        <ul className="prompt-card__grounds" aria-label="What this is based on">
          {prompt.grounds.map(ground => <li key={ground}>{ground}</li>)}
        </ul>
      )}
      <div className="prompt-card__options">
        {prompt.options.map((option, index) => (
          <button
            key={option.id}
            type="button"
            className="prompt-card__option"
            data-primary={index === 0 || undefined}
            onClick={() => onAnswer(option.id, option.label)}
          >
            <span className="prompt-card__option-label">{option.label}</span>
            {option.detail && <span className="prompt-card__option-detail">{option.detail}</span>}
          </button>
        ))}
      </div>
      {prompt.allowFreeText && (
        <form
          className="prompt-card__free"
          onSubmit={event => {
            event.preventDefault();
            const text = freeText.trim();
            if (!text) return;
            onAnswer(undefined, text);
          }}
        >
          <input
            type="text"
            aria-label="Answer in your own words"
            placeholder="Or answer in your own words…"
            value={freeText}
            onChange={event => setFreeText(event.target.value)}
          />
          <button type="submit" disabled={!freeText.trim()}>Send</button>
        </form>
      )}
      <footer className="prompt-card__foot">
        <button type="button" className="prompt-card__decline" onClick={onDecline}>
          Skip this question
        </button>
      </footer>
    </section>
  );
}
