import { useCallback, useEffect, useRef } from 'react';
import { observer } from 'mobx-react-lite';
import { useChatStore, useModelRegistry } from '../../stores/context';
import { EditorialMessage } from './EditorialMessage';
import { EditorialComposer } from './EditorialComposer';

const STICKY_BOTTOM_PX = 100;

export const EditorialChat = observer(function EditorialChat() {
  const chat = useChatStore();
  const registry = useModelRegistry();
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollRafRef = useRef<number | null>(null);
  const lastMessageCountRef = useRef(0);
  const previousStreamingIdRef = useRef<string | null>(null);
  // Sticky-bottom: only auto-scroll when the user is parked near the bottom.
  // If they've scrolled up to read history we leave them there. Updated by a
  // rAF-throttled scroll listener so we're not measuring layout per token.
  const stickyRef = useRef(true);

  const activeThread = chat.activeThread;
  const messages = activeThread?.messages ?? [];
  const streamingId = chat.streamingMessageId;
  const messageCount = messages.length;

  const scheduleScrollToBottom = useCallback(() => {
    if (scrollRafRef.current !== null) return;
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = null;
      const el = scrollRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, []);

  useEffect(() => () => {
    if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current);
  }, []);

  // Watch scroll position. Anything within STICKY_BOTTOM_PX of bottom counts
  // as "at bottom" — covers small offsets from images loading or trailing
  // whitespace. We measure synchronously in the passive scroll listener so a
  // user scrolling up during streaming wins the race against the next token's
  // sync `scrollTop = scrollHeight` write — if we deferred to rAF, the
  // streaming effect could land first and re-pin them to the bottom. The
  // single read of layout properties here is cheap; passive listeners can't
  // block scrolling anyway.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onScroll = () => {
      const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickyRef.current = distance <= STICKY_BOTTOM_PX;
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
    };
  }, []);

  // Thread switch: always reset to bottom and re-arm sticky.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    scheduleScrollToBottom();
    stickyRef.current = true;
  }, [activeThread?.id, scheduleScrollToBottom]);

  // New user message: force-scroll so the just-sent turn is visible even if
  // the user was reading earlier history. Other new messages keep sticky
  // behavior so background arrivals do not yank the scroll position.
  useEffect(() => {
    const previousCount = lastMessageCountRef.current;
    lastMessageCountRef.current = messageCount;
    if (messageCount <= previousCount) return;
    const lastMessage = messages[messageCount - 1];
    if (lastMessage?.role === 'user') {
      stickyRef.current = true;
      scheduleScrollToBottom();
      return;
    }
    if (stickyRef.current) scheduleScrollToBottom();
  }, [messageCount, messages, scheduleScrollToBottom]);

  // While streaming, follow the tail only if the user is parked at the
  // bottom. The observer wrapper re-runs this effect each token flush
  // because `streamingContent` (read from the live message) updates; we
  // gate the scroll on stickyRef so a user who scrolled up is left alone.
  const streamingContent = streamingId
    ? messages.find(m => m.id === streamingId)?.content ?? ''
    : '';
  useEffect(() => {
    if (!streamingId) return;
    if (!stickyRef.current) return;
    scheduleScrollToBottom();
  }, [streamingId, streamingContent, scheduleScrollToBottom]);

  // Response finished: force-scroll once to reveal the final answer tail.
  useEffect(() => {
    const previous = previousStreamingIdRef.current;
    previousStreamingIdRef.current = streamingId;
    if (previous && !streamingId) {
      stickyRef.current = true;
      scheduleScrollToBottom();
    }
  }, [streamingId, scheduleScrollToBottom]);

  return (
    <div style={{
      flex: 1, display: 'flex', flexDirection: 'column',
      minWidth: 0, background: 'var(--bg)', position: 'relative',
    }}>
      <div ref={scrollRef} className="editorial-chat-scroll" style={{ flex: 1, overflowY: 'auto', padding: '36px 48px 8px' }}>
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
      <EditorialComposer textareaRef={textareaRef} />
    </div>
  );
});
