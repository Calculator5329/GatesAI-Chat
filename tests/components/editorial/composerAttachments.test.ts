import { describe, expect, it, vi } from 'vitest';
import {
  handleClipboardImagePaste,
  handleFileDrop,
} from '../../../src/components/editorial/composer/composerAttachments';

describe('composer attachment handlers', () => {
  it('uploads clipboard images through the supplied attachment pipeline', () => {
    const image = new File(['pixels'], '', { type: 'image/png' });
    const text = new File(['ignore'], 'notes.txt', { type: 'text/plain' });
    const event = new Event('paste', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [
          { kind: 'file', type: 'image/png', getAsFile: () => image },
          { kind: 'file', type: 'text/plain', getAsFile: () => text },
        ],
      },
    });
    const upload = vi.fn();

    const handled = handleClipboardImagePaste(event as unknown as {
      clipboardData: DataTransfer;
      preventDefault(): void;
    }, upload);

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(upload).toHaveBeenCalledWith([expect.objectContaining({ type: 'image/png' })]);
  });

  it('uploads a synthetic window drop once through the supplied attachment pipeline', () => {
    const files = [
      new File(['one'], 'one.txt', { type: 'text/plain' }),
      new File(['two'], 'two.png', { type: 'image/png' }),
    ];
    const event = new Event('drop', { cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: {
        files,
        types: ['Files'],
      },
    });
    const upload = vi.fn();

    const handled = handleFileDrop(event as unknown as {
      dataTransfer: DataTransfer;
      preventDefault(): void;
    }, upload);

    expect(handled).toBe(true);
    expect(event.defaultPrevented).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(files);
  });
});
