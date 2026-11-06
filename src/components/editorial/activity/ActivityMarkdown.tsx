import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Memoized on its text: the live activity row re-renders on every stream
 * update, and re-parsing unchanged markdown each time is the expensive part.
 */
export const ActivityMarkdown = memo(function ActivityMarkdown({ content }: { content: string }) {
  return <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>;
});
