import { tokens } from '../../../../core/styleTokens';
import { Pill, SettingsRow, Input, Select } from '../../../ui';

/**
 * Routing settings card. The controls are wired to nothing today — the
 * router always picks the model the user selects in the composer and
 * falls back to the built-in mock responder when no key is configured.
 *
 * Rather than ripping the UI out, we render it explicitly disabled with
 * a Coming-soon pill so users don't think their selection is being
 * honored. Bound `value` (not `defaultValue`) so the inputs can't lie
 * about state once routing is wired up later.
 */
export function RoutingCard() {
  return (
    <div style={{ ...tokens.section, marginTop: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={tokens.sectionTitle}>Routing</div>
        <Pill tone="muted">Coming soon</Pill>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--text-faint)', marginBottom: 14 }}>
        Today the model is chosen in the composer and there is no spend cap. These controls are placeholders for the upcoming router.
      </div>
      <SettingsRow label="Default provider">
        <Select disabled value="openrouter">
          <option value="openrouter">OpenRouter (auto-route)</option>
          <option value="anthropic">Anthropic direct</option>
          <option value="openai">OpenAI direct</option>
          <option value="gemini">Google direct</option>
          <option value="groq">Groq direct</option>
          <option value="local">Local endpoint</option>
        </Select>
      </SettingsRow>
      <SettingsRow label="Fallback when no key">
        <span style={{ color: 'var(--text-dim)' }}>Use the built-in mock responder</span>
      </SettingsRow>
      <SettingsRow label="Monthly spend cap" last>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={tokens.mono}>$</span>
          <Input disabled value="100.00" style={{ ...tokens.mono, width: 120 }} />
          <span style={{ color: 'var(--text-faint)', fontSize: 12 }}>hard stop at limit</span>
        </div>
      </SettingsRow>
    </div>
  );
}
