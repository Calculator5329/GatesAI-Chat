import { describe, expect, it } from 'vitest';
import { iconForActivity } from '../../../src/components/editorial/activity/iconForActivity';
import { Icons } from '../../../src/components/ui/icons';
import type { ActivityItem } from '../../../src/core/types';

const base: Pick<ActivityItem, 'id' | 'state' | 'verb' | 'startedAt'> = {
  id: 'x', state: 'done', verb: 'Using', startedAt: 0,
};

describe('iconForActivity', () => {
  it('returns Brain for thinking kind', () => {
    expect(iconForActivity({ ...base, kind: 'thinking' })).toBe(Icons.Brain);
  });
  it('returns Terminal for exec-tail kind', () => {
    expect(iconForActivity({ ...base, kind: 'exec-tail' })).toBe(Icons.Terminal);
  });
  it('returns Image for image-job kind', () => {
    expect(iconForActivity({ ...base, kind: 'image-job' })).toBe(Icons.Image);
  });
  it('returns Plug for bridge kind', () => {
    expect(iconForActivity({ ...base, kind: 'bridge' })).toBe(Icons.Plug);
  });
  it('returns Edit for tool with edit-like verb', () => {
    expect(iconForActivity({ ...base, kind: 'tool', verb: 'Editing' })).toBe(Icons.Edit);
  });
  it('returns FileText for tool with read-like verb', () => {
    expect(iconForActivity({ ...base, kind: 'tool', verb: 'Reading' })).toBe(Icons.FileText);
  });
  it('returns Search for tool with search-like verb', () => {
    expect(iconForActivity({ ...base, kind: 'tool', verb: 'Searching' })).toBe(Icons.Search);
  });
  it('returns Wrench for unknown tool', () => {
    expect(iconForActivity({ ...base, kind: 'tool', verb: 'Frobnicating' })).toBe(Icons.Wrench);
  });
});
