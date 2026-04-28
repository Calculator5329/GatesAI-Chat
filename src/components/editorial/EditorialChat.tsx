import { useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import type { SendKey, ThreadHeaderKey } from '../../core/types';
import { useChatStore, useModelRegistry } from '../../stores/context';
import { EditorialMessage } from './EditorialMessage';
import { EditorialComposer } from './EditorialComposer';
import { EditorialThreadHeader } from './EditorialThreadHeader';

interface ChatProps {
  sendKey: SendKey;
  threadHeaderKey: ThreadHeaderKey;
}

export const EditorialChat = observer(function EditorialChat({ sendKey, threadHeaderKey }: ChatProps) {
  const chat = useChatStore();
  const registry = useModelRegistry();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeThread = chat.activeThread;
  const messages = activeThread?.messages ?? [];

  // Auto-scroll when a new message row appears or the thread switches.
  // Deliberately excludes streamingMessageId so the viewport stays put while
  // the assistant streams tokens — the user can scroll freely mid-response.
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [activeThread?.id, messages.length]);

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      minWidth: 0, background: 'var(--bg)', position: 'relative',
    }}>
      {activeThread && <EditorialThreadHeader variant={threadHeaderKey} thread={activeThread} />}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '36px 48px 8px' }}>
        <div style={{ width: 'min(var(--reading-width, 720px), 70%)', margin: '0 auto' }} className="editorial-stream">
          {messages.length === 0 && (
            <div style={{
              fontFamily: '"Source Serif 4", Georgia, serif',
              fontStyle: 'italic',
              color: 'var(--text-faint)',
              fontSize: 16,
              padding: '48px 0',
              textAlign: 'center',
            }}>
              A blank page. Say something.
            </div>
          )}
          {messages.map(m => {
            const modelId = m.role === 'assistant' ? m.model : undefined;
            return (
              <EditorialMessage
                key={m.id}
                message={m}
                modelName={modelId ? (registry.findById(modelId)?.name ?? modelId) : undefined}
                streaming={m.id === chat.streamingMessageId}
              />
            );
          })}
        </div>
      </div>
      <EditorialComposer sendKey={sendKey} textareaRef={textareaRef} />
    </div>
  );
});
