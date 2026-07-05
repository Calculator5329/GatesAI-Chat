import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SourceBuildCard,
  SourceChangesReview,
} from '../../../src/components/menu/sections/Workspace';
import type { LineDiffRow } from '../../../src/stores/SourceWorkspaceStore';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
const changedDiffRows: LineDiffRow[] = [
  { type: 'removed', text: 'old', oldLine: 1 },
  { type: 'added', text: 'new', newLine: 1 },
  { type: 'context', text: 'same', oldLine: 2, newLine: 2 },
];

function render(element: ReactElement): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root!.render(element);
  });
  return host;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('SourceChangesReview', () => {
  it('renders changed files, diff preview, and inline revert confirmation', () => {
    const onRevertFile = vi.fn();
    const rendered = render(createElement(SourceChangesReview, {
      loading: false,
      disabled: false,
      onRefresh: vi.fn(),
      onRevertFile,
      diffRowsForFile: () => changedDiffRows,
      changes: {
        files: [{
          path: 'source://src/App.tsx',
          change: 'modified',
          originalSize: 9,
          currentSize: 9,
          previewAvailable: true,
          originalContent: 'old\nsame',
          currentContent: 'new\nsame',
        }],
      },
    }));

    expect(rendered.textContent).toContain('1 file');
    expect(rendered.textContent).toContain('src/App.tsx');
    expect(rendered.textContent).toContain('old');
    expect(rendered.textContent).toContain('new');

    const revert = Array.from(rendered.querySelectorAll('button')).find(button => button.textContent === 'Revert')!;
    act(() => revert.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(rendered.textContent).toContain('Confirm');

    const confirm = Array.from(rendered.querySelectorAll('button')).find(button => button.textContent === 'Confirm')!;
    act(() => confirm.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onRevertFile).toHaveBeenCalledWith('source://src/App.tsx');
  });

  it('shows no preview for binary or huge files', () => {
    const rendered = render(createElement(SourceChangesReview, {
      loading: false,
      disabled: false,
      onRefresh: vi.fn(),
      onRevertFile: vi.fn(),
      diffRowsForFile: () => [],
      changes: {
        files: [{
          path: 'source://asset.bin',
          change: 'modified',
          originalSize: 300_000,
          currentSize: 300_001,
          previewAvailable: false,
        }],
      },
    }));

    expect(rendered.textContent).toContain('changed (no diff preview)');
  });
});

describe('SourceBuildCard', () => {
  it('renders running and succeeded build states with log and output handoff', () => {
    const onStart = vi.fn();
    const onOpenOutputFolder = vi.fn();
    const rendered = render(createElement(SourceBuildCard, {
      status: {
        status: 'running',
        jobKind: 'build',
        command: 'package',
        cmdline: 'npm.cmd run tauri:build',
        startedAtUnix: 1_800_000_000,
        steps: [
          { id: 'package', label: 'package', cmdline: 'npm.cmd run tauri:build', status: 'running', startedAtUnix: 1_800_000_000 },
        ],
        logs: ['$ npm.cmd run tauri:build', '[stdout] compiling'],
      },
      sourcePrepared: true,
      changes: null,
      loading: false,
      error: null,
      unavailable: false,
      onStart,
      onRefresh: vi.fn(),
      onClear: vi.fn(),
      onOpenOutputFolder,
    }));

    expect(rendered.textContent).toContain('running');
    expect(rendered.textContent).toContain('[stdout] compiling');

    const runBuild = Array.from(rendered.querySelectorAll('button')).find(button => button.textContent === 'Run build')!;
    expect(runBuild.hasAttribute('disabled')).toBe(true);

    act(() => {
      root!.render(createElement(SourceBuildCard, {
        status: {
          status: 'succeeded',
          jobKind: 'build',
          command: 'package',
          cmdline: 'npm.cmd run tauri:build',
          startedAtUnix: 1_800_000_000,
          finishedAtUnix: 1_800_000_120,
          exitCode: 0,
          steps: [
            {
              id: 'package',
              label: 'package',
              cmdline: 'npm.cmd run tauri:build',
              status: 'succeeded',
              startedAtUnix: 1_800_000_000,
              finishedAtUnix: 1_800_000_120,
              exitCode: 0,
            },
          ],
          logs: ['$ npm.cmd run tauri:build', '[stdout] done'],
          installerPath: 'C:/out/GatesAI.exe',
          installerBytes: 1024,
          lastTest: {
            jobKind: 'test',
            command: 'test',
            status: 'succeeded',
            startedAtUnix: 1_799_999_900,
            finishedAtUnix: 1_799_999_990,
            exitCode: 0,
            steps: [
              { id: 'test', label: 'test', cmdline: 'npm.cmd test', status: 'succeeded', exitCode: 0 },
              { id: 'typecheck', label: 'typecheck', cmdline: 'npm.cmd run typecheck', status: 'succeeded', exitCode: 0 },
              { id: 'lint', label: 'lint', cmdline: 'npm.cmd run lint', status: 'succeeded', exitCode: 0 },
            ],
          },
        },
        sourcePrepared: true,
        changes: null,
        loading: false,
        error: null,
        unavailable: false,
        onStart,
        onRefresh: vi.fn(),
        onClear: vi.fn(),
        onOpenOutputFolder,
      }));
    });

    expect(rendered.textContent).toContain('succeeded');
    expect(rendered.textContent).toContain('Last test');
    expect(rendered.textContent).toContain('artifact: C:/out/GatesAI.exe');
    const open = Array.from(rendered.querySelectorAll('button')).find(button => button.textContent === 'Open output folder')!;
    act(() => open.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onOpenOutputFolder).toHaveBeenCalledWith('C:/out/GatesAI.exe');
  });

  it('keeps build clickable while warning when tests are stale', () => {
    const onStart = vi.fn();
    const rendered = render(createElement(SourceBuildCard, {
      status: {
        status: 'succeeded',
        jobKind: 'test',
        command: 'test',
        cmdline: 'npm.cmd test',
        startedAtUnix: 1_800_000_000,
        finishedAtUnix: 1_800_000_010,
        exitCode: 0,
        steps: [
          { id: 'test', label: 'test', cmdline: 'npm.cmd test', status: 'succeeded', exitCode: 0 },
          { id: 'typecheck', label: 'typecheck', cmdline: 'npm.cmd run typecheck', status: 'succeeded', exitCode: 0 },
          { id: 'lint', label: 'lint', cmdline: 'npm.cmd run lint', status: 'succeeded', exitCode: 0 },
        ],
        logs: [],
        lastTest: {
          jobKind: 'test',
          command: 'test',
          status: 'succeeded',
          startedAtUnix: 1_800_000_000,
          finishedAtUnix: 1_800_000_010,
          exitCode: 0,
          steps: [
            { id: 'test', label: 'test', cmdline: 'npm.cmd test', status: 'succeeded', exitCode: 0 },
          ],
        },
      },
      sourcePrepared: true,
      changes: { files: [], latestChangeAtUnix: 1_800_000_020 },
      loading: false,
      error: null,
      unavailable: false,
      onStart,
      onRefresh: vi.fn(),
      onClear: vi.fn(),
      onOpenOutputFolder: vi.fn(),
    }));

    expect(rendered.textContent).toContain("tests haven't passed since the last edit");
    const runBuild = Array.from(rendered.querySelectorAll('button')).find(button => button.textContent === 'Run build')!;
    expect(runBuild.hasAttribute('disabled')).toBe(false);
    act(() => runBuild.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onStart).toHaveBeenCalledWith('package');
  });
});
