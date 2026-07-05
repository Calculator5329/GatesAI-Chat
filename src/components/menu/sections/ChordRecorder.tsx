import { useState, type KeyboardEvent } from 'react';
import { Button } from '../../ui';
import { chordFromKeyboardEvent } from '../../../core/shortcutChord';

interface ChordRecorderProps {
  value: string;
  onChange: (value: string) => void;
  onReset: () => void;
  disabled?: boolean;
}

export function ChordRecorder({ value, onChange, onReset, disabled }: ChordRecorderProps) {
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    event.preventDefault();
    event.stopPropagation();
    const next = chordFromKeyboardEvent(event.nativeEvent);
    if (!next) {
      setError('Press at least one modifier and a key.');
      return;
    }
    setError(null);
    setRecording(false);
    onChange(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <input
          aria-label="Global summon shortcut"
          readOnly
          disabled={disabled}
          value={recording ? 'Press shortcut...' : value}
          onFocus={() => {
            if (!disabled) {
              setRecording(true);
              setError(null);
            }
          }}
          onBlur={() => setRecording(false)}
          onKeyDown={handleKeyDown}
          style={{
            width: 190,
            height: 30,
            borderRadius: 6,
            border: '1px solid var(--border)',
            background: 'var(--bg-elev)',
            color: 'var(--text)',
            padding: '0 10px',
            font: 'inherit',
            fontSize: 12.5,
          }}
        />
        <Button type="button" disabled={disabled} onClick={onReset}>Reset</Button>
      </div>
      {error && <div style={{ fontSize: 11.5, color: 'var(--danger)' }}>{error}</div>}
    </div>
  );
}
