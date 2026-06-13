import { describe, expect, it } from 'vitest';
import {
  formatAttachmentFooter,
  resolveUserAttachments,
  splitAttachmentFooter,
  toMessageAttachmentRef,
} from '../../src/core/attachments';

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
        cacheKey: '/workspace/attachments/plan.csv:10.7KB:0:legacy',
        path: '/workspace/attachments/plan.csv',
        name: 'plan.csv',
        size: '10.7KB',
        kind: 'CSV',
        mime: 'text/csv',
        isImage: false,
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

describe('resolveUserAttachments', () => {
  it('prefers structured refs over the legacy footer', () => {
    const refs = [
      toMessageAttachmentRef({
        id: 'att-1',
        path: '/workspace/attachments/shot.png',
        filename: 'shot.png',
        size: 2_048,
        mime: 'image/png',
      }),
    ];
    const { body, attachments } = resolveUserAttachments({
      content: 'Look at this.',
      attachments: refs,
    });

    expect(body).toBe('Look at this.');
    expect(attachments).toEqual([
      {
        id: 'att-1',
        cacheKey: 'att-1',
        path: '/workspace/attachments/shot.png',
        name: 'shot.png',
        size: '2.0KB',
        kind: 'PNG',
        mime: 'image/png',
        isImage: true,
      },
    ]);
  });

  it('strips the footer from body when structured refs are also present', () => {
    const footer = formatAttachmentFooter([
      { path: '/workspace/attachments/plan.csv', size: 1024, mime: 'text/csv' },
    ]);
    const refs = [
      toMessageAttachmentRef({
        id: 'att-2',
        path: '/workspace/attachments/plan.csv',
        filename: 'plan.csv',
        size: 1024,
        mime: 'text/csv',
      }),
    ];

    const { body, attachments } = resolveUserAttachments({
      content: `Hi.${footer}`,
      attachments: refs,
    });

    expect(body).toBe('Hi.');
    expect(attachments).toHaveLength(1);
  });

  it('falls back to footer parsing for legacy messages without refs', () => {
    const footer = formatAttachmentFooter([
      { path: '/workspace/attachments/old.json', size: 512, mime: 'application/json' },
    ]);
    const { body, attachments } = resolveUserAttachments({ content: `Legacy.${footer}` });

    expect(body).toBe('Legacy.');
    expect(attachments).toEqual([
      {
        cacheKey: '/workspace/attachments/old.json:512B:0:legacy',
        path: '/workspace/attachments/old.json',
        name: 'old.json',
        size: '512B',
        kind: 'JSON',
        mime: 'application/json',
        isImage: false,
      },
    ]);
  });
});
