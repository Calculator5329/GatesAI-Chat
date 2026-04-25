import { describe, expect, it } from 'vitest';
import { formatAttachmentFooter, splitAttachmentFooter } from '../../src/core/attachments';

describe('attachment message footer formatting', () => {
  it('formats and parses the model-facing attachment footer with one shared contract', () => {
    const footer = formatAttachmentFooter([
      {
        path: '/workspace/attachments/plan.csv',
        size: 10_944,
        mime: 'text/csv',
      },
    ]);

    expect(footer).toContain('inspect_file');
    expect(footer).toContain('byte-level reads/writes');

    const parsed = splitAttachmentFooter(`Normalize this.${footer}`);

    expect(parsed.body).toBe('Normalize this.');
    expect(parsed.attachments).toEqual([
      {
        path: '/workspace/attachments/plan.csv',
        name: 'plan.csv',
        size: '10.7KB',
        kind: 'CSV',
      },
    ]);
  });

  it('leaves ordinary message content untouched', () => {
    expect(splitAttachmentFooter('No files here.')).toEqual({
      body: 'No files here.',
      attachments: [],
    });
    expect(formatAttachmentFooter([])).toBe('');
  });
});
