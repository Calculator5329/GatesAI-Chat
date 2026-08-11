// The pack switch for assistant activity: Classic renders quiet grouped rows,
// Aurora renders a chip header over a typed trace. Both read the same items.
import { observer } from 'mobx-react-lite';
import type { ActivityItem } from '../../../core/types';
import { useUiPack } from '../../../stores/context';
import { AuroraActivityStream } from '../aurora/AuroraActivityStream';
import { ActivityRow } from './ActivityRow';
import { TimelineGroup } from './TimelineGroup';
import { groupConsecutive } from './groupConsecutive';

export const ActivityStream = observer(function ActivityStream({
  items,
  header,
  messageId,
  onOpenThread,
}: {
  items: ActivityItem[];
  header?: string;
  messageId?: string;
  onOpenThread?: (threadId: string) => void;
}) {
  const pack = useUiPack();
  if (items.length === 0 && !header) return null;
  if (pack === 'aurora') {
    return <AuroraActivityStream items={items} header={header} messageId={messageId} onOpenThread={onOpenThread} />;
  }
  const runs = groupConsecutive(items);
  return (
    <div className="activity-stream" aria-label="Assistant activity">
      {header && <div className="activity-stream__header">{header}</div>}
      {runs.map((run, index) =>
        run.length === 1
          ? <ActivityRow key={`${run[0].id}-${index}`} item={run[0]} messageId={messageId} onOpenThread={onOpenThread} />
          : <TimelineGroup key={`group-${run[0].id}-${index}`} items={run} messageId={messageId} onOpenThread={onOpenThread} />,
      )}
    </div>
  );
});
