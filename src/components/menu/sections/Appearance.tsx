import { useState, type CSSProperties, type ReactNode } from 'react';
import { observer } from 'mobx-react-lite';
import { tokens } from '../../../core/styleTokens';
import { Card, SettingsRow, Toggle, Select, SegmentedControl, ToolCallView, ToolResultView } from '../../ui';
import { useUiStore } from '../../../stores/context';
import type {
  CodeSizeKey,
  CodeStyleKey,
  MarkdownDensityKey,
  MarkdownStyleKey,
  ToolCallStyleKey,
  ToolResult,
} from '../../../core/types';
import type { ToolCall } from '../../../core/llm';

const DENSITY = ['compact', 'comfortable', 'spacious'] as const;
type Density = typeof DENSITY[number];

const MARKDOWN_DENSITY: MarkdownDensityKey[] = ['compact', 'comfortable', 'spacious'];
const CODE_SIZE: CodeSizeKey[] = ['small', 'medium', 'large'];

export const AppearanceSection = observer(function AppearanceSection() {
  const [density, setDensity] = useState<Density>('comfortable');

  return (
    <>
      <h1 style={tokens.h1}>Appearance</h1>
      <div style={tokens.kicker}>visual preferences</div>

      <Card style={{ padding: '18px 20px', marginBottom: 20 }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-dim)', lineHeight: 1.55 }}>
          The quick design options (accent, background, header) are in the Tweaks panel — toggle Tweaks in the toolbar.
          Long-term we'll move them here.
        </div>
      </Card>

      <ToolCallStylePicker />
      <MarkdownStylePicker />
      <CodeStylePicker />
      <MarkdownCodeAdvanced />

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>Reading</div>
        <SettingsRow label="Serif for AI voice">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle on onChange={() => {}} />
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Source Serif 4 for responses</span>
          </div>
        </SettingsRow>
        <SettingsRow label="Reading width">
          <Select defaultValue="720">
            <option value="640">Narrow (640px)</option>
            <option value="720">Comfortable (720px)</option>
            <option value="860">Wide (860px)</option>
          </Select>
        </SettingsRow>
        <SettingsRow label="Font size" last>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input type="range" min="14" max="20" step="1" defaultValue="17"
              style={{ flex: 1, accentColor: 'var(--accent)' }} />
            <span style={{ ...tokens.mono, color: 'var(--text-dim)', width: 32 }}>17px</span>
          </div>
        </SettingsRow>
      </div>

      <div style={tokens.section}>
        <div style={tokens.sectionTitle}>Density</div>
        <SettingsRow label="Layout">
          <SegmentedControl options={DENSITY} value={density} onChange={setDensity} />
        </SettingsRow>
        <SettingsRow label="Animations" last>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Toggle on onChange={() => {}} />
            <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>Subtle transitions</span>
          </div>
        </SettingsRow>
      </div>
    </>
  );
});

// ─────────────────────────────────────────────────────────────────────────
// Markdown + code appearance pickers — presets first, tiny advanced controls
// second. These write to UiStore and apply globally through App root classes.
// ─────────────────────────────────────────────────────────────────────────

interface MarkdownVariantMeta {
  key: MarkdownStyleKey;
  label: string;
  blurb: string;
  className: string;
}

const MARKDOWN_VARIANTS: MarkdownVariantMeta[] = [
  { key: 'editorial', label: 'Editorial', blurb: 'Serif, calm headings, generous reading rhythm.', className: 'markdown-editorial markdown-density-comfortable code-obsidian code-size-medium' },
  { key: 'technical', label: 'Technical', blurb: 'Sans body, firmer headings, easier scanning.', className: 'markdown-technical markdown-density-comfortable code-obsidian code-size-medium' },
  { key: 'compact', label: 'Compact', blurb: 'Tighter paragraphs and lists for dense sessions.', className: 'markdown-compact markdown-density-compact code-obsidian code-size-medium' },
];

interface CodeVariantMeta {
  key: CodeStyleKey;
  label: string;
  blurb: string;
  className: string;
}

const CODE_VARIANTS: CodeVariantMeta[] = [
  { key: 'obsidian', label: 'Obsidian', blurb: 'Current dark slab. Quiet, sturdy, readable.', className: 'markdown-editorial markdown-density-comfortable code-obsidian code-size-medium' },
  { key: 'terminal', label: 'Terminal', blurb: 'Sharper border, darker well, accent glow.', className: 'markdown-editorial markdown-density-comfortable code-terminal code-size-medium' },
  { key: 'paper', label: 'Paper', blurb: 'Softer panel for long explanations and snippets.', className: 'markdown-editorial markdown-density-comfortable code-paper code-size-medium' },
];

const SAMPLE_CODE = 'const answer = await gates.ask(prompt);\nreturn answer.trim();';

const MarkdownStylePicker = observer(function MarkdownStylePicker() {
  const ui = useUiStore();
  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>Markdown style</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.55 }}>
        Tune how assistant prose, headings, lists, and inline code feel in the chat stream.
      </div>
      <div style={cardGrid}>
        {MARKDOWN_VARIANTS.map(v => (
          <AppearanceCard
            key={v.key}
            label={v.label}
            blurb={v.blurb}
            selected={ui.markdownStyle === v.key}
            onSelect={() => ui.setMarkdownStyle(v.key)}
          >
            <div className={v.className} style={previewSurface}>
              <div className="md-body">
                <h3>Reasoning notes</h3>
                <p>Markdown can feel literary, technical, or dense without changing the message itself.</p>
                <ul>
                  <li>Readable lists</li>
                  <li><code>inline code</code> that stays quiet</li>
                </ul>
              </div>
            </div>
          </AppearanceCard>
        ))}
      </div>
    </div>
  );
});

const CodeStylePicker = observer(function CodeStylePicker() {
  const ui = useUiStore();
  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>Code blocks</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.55 }}>
        Choose the frame code outputs use inside markdown responses.
      </div>
      <div style={cardGrid}>
        {CODE_VARIANTS.map(v => (
          <AppearanceCard
            key={v.key}
            label={v.label}
            blurb={v.blurb}
            selected={ui.codeStyle === v.key}
            onSelect={() => ui.setCodeStyle(v.key)}
          >
            <div className={v.className} style={previewSurface}>
              <div className="md-body">
                <pre><code className="hljs">{SAMPLE_CODE}</code></pre>
              </div>
            </div>
          </AppearanceCard>
        ))}
      </div>
    </div>
  );
});

const MarkdownCodeAdvanced = observer(function MarkdownCodeAdvanced() {
  const ui = useUiStore();
  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>Advanced reading tweaks</div>
      <SettingsRow label="Markdown density">
        <SegmentedControl options={MARKDOWN_DENSITY} value={ui.markdownDensity} onChange={(value) => ui.setMarkdownDensity(value)} />
      </SettingsRow>
      <SettingsRow label="Code size" last>
        <SegmentedControl options={CODE_SIZE} value={ui.codeSize} onChange={(value) => ui.setCodeSize(value)} />
      </SettingsRow>
    </div>
  );
});

function AppearanceCard({
  label,
  blurb,
  selected,
  onSelect,
  children,
}: {
  label: string;
  blurb: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={variantButtonStyle(selected)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{
          ...tokens.mono, fontSize: 11,
          color: selected ? 'var(--accent)' : 'var(--text-dim)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          {label}
        </span>
        {selected && <SelectedBadge />}
      </div>
      <div style={{
        fontSize: 12, color: 'var(--text-faint)',
        lineHeight: 1.5, marginBottom: 14,
      }}>
        {blurb}
      </div>
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Tool-call style picker — five live previews using the same renderers
// the chat uses, so what you see here is exactly what you'll get.
// ─────────────────────────────────────────────────────────────────────────

interface VariantMeta {
  key: ToolCallStyleKey;
  label: string;
  blurb: string;
}

const VARIANTS: VariantMeta[] = [
  { key: 'whisper', label: 'Whisper', blurb: 'Single dim mono line. "tool · result". One breath.' },
  { key: 'dot',     label: 'Dot',     blurb: 'A small accent dot and the tool name. Hover for the result.' },
  { key: 'aside',   label: 'Aside',   blurb: 'Italic serif murmur. Reads as a parenthetical, not machinery.' },
  { key: 'mark',    label: 'Mark',    blurb: 'A short accent rule in the margin. No text. Maximum quiet.' },
  { key: 'hidden',  label: 'Hidden',  blurb: 'Tools work; you never see them. The reply stands alone.' },
];

const SAMPLE_CALL: ToolCall = {
  id: 'preview',
  name: 'memory',
  arguments: { action: 'add', fact: 'User prefers short responses.' },
};

const SAMPLE_RESULT: ToolResult = {
  toolCallId: 'preview',
  toolName: 'memory',
  content: 'Saved: "User prefers short responses."',
  ranAt: Date.now(),
};

const ToolCallStylePicker = observer(function ToolCallStylePicker() {
  const ui = useUiStore();
  return (
    <div style={tokens.section}>
      <div style={tokens.sectionTitle}>Tool-call style</div>
      <div style={{ fontSize: 12.5, color: 'var(--text-dim)', marginBottom: 14, lineHeight: 1.55 }}>
        How the assistant's tool invocations and their results render in chat.
        Pick one — the change applies live everywhere.
      </div>

      <div style={{
        ...cardGrid,
      }}>
        {VARIANTS.map(v => (
          <VariantCard
            key={v.key}
            meta={v}
            selected={ui.toolCallStyle === v.key}
            onSelect={() => ui.setToolCallStyle(v.key)}
          />
        ))}
      </div>
    </div>
  );
});

function VariantCard({ meta, selected, onSelect }: { meta: VariantMeta; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      style={variantButtonStyle(selected)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{
          ...tokens.mono, fontSize: 11,
          color: selected ? 'var(--accent)' : 'var(--text-dim)',
          letterSpacing: '0.12em', textTransform: 'uppercase',
        }}>
          {meta.label}
        </span>
        {selected && <SelectedBadge />}
      </div>
      <div style={{
        fontSize: 12, color: 'var(--text-faint)',
        lineHeight: 1.5, marginBottom: 14,
      }}>
        {meta.blurb}
      </div>

      {/*
        Live preview using the actual renderers. We frame it inside a quiet
        surface so each variant's whitespace reads true. For `hidden` we
        show an explicit empty-state line so the card doesn't look broken.
      */}
      <div style={previewSurface}>
        <ToolCallView call={SAMPLE_CALL} style={meta.key} />
        <ToolResultView result={SAMPLE_RESULT} style={meta.key} />
        {meta.key === 'hidden' && (
          <div style={{
            ...tokens.mono, fontSize: 10, color: 'var(--text-faint)',
            letterSpacing: '0.14em', textTransform: 'uppercase',
            opacity: 0.5,
          }}>
            (nothing rendered)
          </div>
        )}
      </div>
    </button>
  );
}

function SelectedBadge() {
  return (
    <span style={{
      ...tokens.mono, fontSize: 9.5,
      padding: '1px 6px', borderRadius: 999,
      background: 'var(--accent)',
      color: 'var(--bg)',
      letterSpacing: '0.12em', textTransform: 'uppercase',
    }}>
      active
    </span>
  );
}

const cardGrid: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
  gap: 14,
};

function variantButtonStyle(selected: boolean): CSSProperties {
  return {
    display: 'flex', flexDirection: 'column',
    textAlign: 'left',
    padding: 16,
    border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
    borderRadius: 6,
    background: selected
      ? 'color-mix(in srgb, var(--accent) 6%, transparent)'
      : 'transparent',
    cursor: 'pointer',
    transition: 'border-color 120ms ease, background 120ms ease',
    boxShadow: selected
      ? '0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent)'
      : 'none',
  };
}

const previewSurface: CSSProperties = {
  padding: '14px 16px',
  minHeight: 56,
  border: '1px solid var(--border)',
  borderRadius: 4,
  background: 'color-mix(in srgb, var(--bg) 96%, var(--text) 4%)',
  display: 'flex', flexDirection: 'column',
  justifyContent: 'center',
};
