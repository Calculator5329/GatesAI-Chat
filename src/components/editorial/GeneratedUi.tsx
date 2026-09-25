// Draws a validated `render_ui` spec inline in an assistant message.
// Called by ActivityRow for `ui` artifacts; depends on the core uiCatalog and @json-render/react.
// Invariant: the component registry is pure; store access stays in the GeneratedUi wrapper.
import { useMemo, type ReactNode } from 'react';
import { defineRegistry, JSONUIProvider, Renderer } from '@json-render/react';
import { uiCatalog, type UiSpec } from '../../core/uiCatalog';
import { useEditorial } from '../../stores/context';
import { Button } from '../ui';

/**
 * The live handler is bound per render by {@link GeneratedUi} through
 * `JSONUIProvider.handlers`, because sending a message needs the chat store.
 * defineRegistry still requires an entry for every catalog action, so this
 * placeholder keeps the registry pure and module-level.
 */
async function sendMessageIsBoundByProvider(): Promise<void> {}

const { registry } = defineRegistry(uiCatalog, {
  components: {
    Stack: ({ props, children }) => (
      <div className="generated-ui__stack" data-direction={props.direction}>{children}</div>
    ),
    Heading: ({ props }) => <div className="generated-ui__heading">{props.text}</div>,
    Text: ({ props }) => <p className="generated-ui__text">{props.text}</p>,
    Stat: ({ props }) => (
      <div className="generated-ui__stat">
        <span className="generated-ui__stat-value">{props.value}</span>
        <span className="generated-ui__stat-label">{props.label}</span>
        {props.hint && <span className="generated-ui__stat-hint">{props.hint}</span>}
      </div>
    ),
    Table: ({ props }) => (
      <div className="generated-ui__table-wrap">
        <table className="generated-ui__table">
          <thead>
            <tr>{props.columns.map((column, index) => <th key={`${index}-${column}`}>{column}</th>)}</tr>
          </thead>
          <tbody>
            {props.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {props.columns.map((_, cellIndex) => <td key={cellIndex}>{row[cellIndex] ?? ''}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
    List: ({ props }) => (
      <ul className="generated-ui__list">
        {props.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
      </ul>
    ),
    Badge: ({ props }) => <span className="generated-ui__badge" data-tone={props.tone}>{props.text}</span>,
    Callout: ({ props }) => <div className="generated-ui__callout" data-tone={props.tone}>{props.text}</div>,
    Progress: ({ props }) => {
      const value = Math.max(0, Math.min(100, props.value));
      return (
        <div className="generated-ui__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} aria-label={props.label}>
          <div className="generated-ui__progress-head">
            <span>{props.label}</span>
            <span className="generated-ui__progress-value">{Math.round(value)}%</span>
          </div>
          <div className="generated-ui__progress-track">
            <div className="generated-ui__progress-fill" style={{ width: `${value}%` }} />
          </div>
        </div>
      );
    },
    Button: ({ props, emit }) => (
      <Button data-testid="workspace.generated-ui.button" type="button" className="generated-ui__button" onClick={() => emit('press')}>{props.label}</Button>
    ),
    Divider: () => <hr className="generated-ui__divider" />,
  },
  actions: {
    send_message: sendMessageIsBoundByProvider,
  },
});

export interface GeneratedUiViewProps {
  spec: UiSpec;
  title?: string;
  onSendMessage: (text: string) => void;
}

/** Store-free renderer; ActivityRow uses the store-backed {@link GeneratedUi}. */
export function GeneratedUiView({ spec, title, onSendMessage }: GeneratedUiViewProps): ReactNode {
  const handlers = useMemo(() => ({
    send_message: (params: Record<string, unknown>) => {
      const text = typeof params.text === 'string' ? params.text.trim() : '';
      if (text) onSendMessage(text);
    },
  }), [onSendMessage]);
  return (
    <div className="generated-ui" data-testid="workspace.generated-ui.view">
      {title && <div className="generated-ui__title">{title}</div>}
      <JSONUIProvider registry={registry} handlers={handlers}>
        <Renderer spec={spec} registry={registry} />
      </JSONUIProvider>
    </div>
  );
}

export function GeneratedUi({ spec, title }: { spec: UiSpec; title?: string }): ReactNode {
  const { chat } = useEditorial();
  return <GeneratedUiView spec={spec} title={title} onSendMessage={text => chat.sendMessage(text)} />;
}
