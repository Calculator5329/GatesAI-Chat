import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSourceChangedFiles,
  revertSourceFile,
} from '../../src/services/sourceWorkspace';

const invokeMock = vi.hoisted(() => vi.fn());
const runtimeMock = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: invokeMock,
}));

vi.mock('../../src/core/runtime', () => runtimeMock);

describe('sourceWorkspace service', () => {
  beforeEach(() => {
    invokeMock.mockReset();
    runtimeMock.isTauri.mockReturnValue(true);
  });

  it('invokes the changed-files review command', async () => {
    invokeMock.mockResolvedValueOnce({
      files: [{
        path: 'source://src/App.tsx',
        change: 'modified',
        originalSize: 10,
        currentSize: 12,
        previewAvailable: true,
        originalContent: 'old',
        currentContent: 'new',
      }],
    });

    const result = await getSourceChangedFiles();

    expect(invokeMock).toHaveBeenCalledWith('source_changed_files');
    expect(result.files[0].path).toBe('source://src/App.tsx');
    expect(result.files[0].change).toBe('modified');
  });

  it('invokes the per-file revert command', async () => {
    invokeMock.mockResolvedValueOnce({ path: 'source://src/App.tsx', change: 'modified' });

    await expect(revertSourceFile('source://src/App.tsx')).resolves.toEqual({
      path: 'source://src/App.tsx',
      change: 'modified',
    });
    expect(invokeMock).toHaveBeenCalledWith('source_revert_file', { path: 'source://src/App.tsx' });
  });

  it('rejects outside Tauri before invoking commands', async () => {
    runtimeMock.isTauri.mockReturnValue(false);

    await expect(getSourceChangedFiles()).rejects.toThrow('Cannot review source workspace changes');
    expect(invokeMock).not.toHaveBeenCalled();
  });
});
