import type { JSX } from 'react';
import type { ActivityItem } from '../../../core/types';
import { Icons } from '../../ui/icons';

const VERB_ICONS: Array<[RegExp, () => JSX.Element]> = [
  [/^edit/i,    Icons.Edit],
  [/^writ/i,    Icons.Edit],
  [/^read/i,    Icons.FileText],
  [/^view/i,    Icons.FileText],
  [/^search/i,  Icons.Search],
  [/^grep/i,    Icons.Search],
  [/^find/i,    Icons.Search],
  [/^ran/i,     Icons.Terminal],
  [/^run/i,     Icons.Terminal],
];

export function iconForActivity(item: ActivityItem): () => JSX.Element {
  switch (item.kind) {
    case 'thinking':  return Icons.Brain;
    case 'exec-tail': return Icons.Terminal;
    case 'image-job': return Icons.Image;
    case 'bridge':    return Icons.Plug;
    case 'agent-task': return Icons.Brain;
    case 'tool': {
      for (const [pattern, icon] of VERB_ICONS) {
        if (pattern.test(item.verb)) return icon;
      }
      return Icons.Wrench;
    }
  }
}
