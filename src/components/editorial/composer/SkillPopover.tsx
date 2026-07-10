// Workspace-skill picker popover anchored above the composer meta row. Purely
// presentational: it receives the skill list and selection callbacks; skill
// loading/refresh lives in SkillsStore. Desktop-only (hidden in Web Lite).
import { useEffect, useRef } from 'react';
import type { WorkspaceSkill } from '../../../stores/SkillsStore';

export function SkillPopover({
  skills,
  loading,
  activeSkillId,
  onPick,
  onClose,
}: {
  skills: WorkspaceSkill[];
  loading: boolean;
  activeSkillId?: string;
  onPick: (skillId: string | undefined) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleDocClick);
    return () => document.removeEventListener('mousedown', handleDocClick);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="skill-popover"
      role="listbox"
      aria-label="Workspace skills"
      style={{
        position: 'absolute', bottom: 'calc(100% + 8px)', left: 0,
        width: 320, maxHeight: 360,
        display: 'flex', flexDirection: 'column',
        background: 'var(--panel)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        overflow: 'hidden',
        zIndex: 30,
        fontFamily: '"Geist", ui-sans-serif, system-ui, sans-serif',
      }}
    >
      <SkillRow
        name="No skill"
        description="Use only the global Agent instructions."
        selected={!activeSkillId}
        onClick={() => onPick(undefined)}
      />
      <div style={{ overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
        {skills.map(skill => (
          <SkillRow
            key={skill.id}
            name={skill.name}
            description={skill.description || skill.path}
            selected={activeSkillId === skill.id}
            warnings={skill.warnings}
            onClick={() => onPick(skill.id)}
          />
        ))}
        {!loading && skills.length === 0 && (
          <div style={{
            padding: '18px 16px',
            color: 'var(--text-faint)',
            fontSize: 12,
            fontStyle: 'italic',
            fontFamily: '"Source Serif 4", Georgia, serif',
          }}>
            No workspace skills found.
          </div>
        )}
        {loading && (
          <div style={{ padding: '12px 16px', color: 'var(--text-faint)', fontSize: 11 }}>
            Loading skills...
          </div>
        )}
      </div>
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid var(--border)',
        fontFamily: '"Geist Mono", monospace',
        fontSize: 10,
        color: 'var(--text-faint)',
      }}>
        Add markdown packs in /workspace/skills/
      </div>
    </div>
  );
}

function SkillRow({
  name,
  description,
  selected,
  warnings,
  onClick,
}: {
  name: string;
  description: string;
  selected: boolean;
  warnings?: string[];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="skill-popover__row"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      style={{
        width: '100%',
        display: 'grid',
        gap: 3,
        padding: '10px 14px',
        textAlign: 'left',
        border: 'none',
        borderLeft: selected ? '2px solid var(--accent)' : '2px solid transparent',
        background: selected ? 'var(--panel-2)' : 'transparent',
        color: 'var(--text-dim)',
        cursor: 'pointer',
      }}
    >
      <span style={{ fontSize: 13, color: selected ? 'var(--text)' : 'var(--text-dim)' }}>{name}</span>
      <span style={{
        fontFamily: '"Source Serif 4", Georgia, serif',
        fontSize: 11.5,
        lineHeight: 1.35,
        fontStyle: 'italic',
        color: 'var(--text-faint)',
      }}>
        {description}
      </span>
      {warnings && warnings.length > 0 && (
        <span style={{ fontFamily: '"Geist Mono", monospace', fontSize: 10, color: 'var(--warning)' }}>
          {warnings.length} warning{warnings.length === 1 ? '' : 's'}
        </span>
      )}
    </button>
  );
}
