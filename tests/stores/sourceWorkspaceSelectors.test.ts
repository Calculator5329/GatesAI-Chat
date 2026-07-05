import { describe, expect, it } from 'vitest';
import { lastBuildForRuntime, lastTestForRuntime, sourceTestFreshness } from '../../src/stores/sourceWorkspaceSelectors';

describe('source workspace selectors', () => {
  it('warns when tests have not passed since the latest source change', () => {
    expect(sourceTestFreshness(
      { files: [], latestChangeAtUnix: 200 },
      {
        jobKind: 'test',
        command: 'test',
        status: 'succeeded',
        startedAtUnix: 100,
        finishedAtUnix: 150,
        exitCode: 0,
        steps: [],
      },
    )).toEqual({
      passedSinceLatestChange: false,
      needsAttention: true,
      label: "tests haven't passed since the last edit",
    });
  });

  it('accepts a passing test newer than the latest source change', () => {
    expect(sourceTestFreshness(
      { files: [], latestChangeAtUnix: 200 },
      {
        jobKind: 'test',
        command: 'test',
        status: 'succeeded',
        startedAtUnix: 210,
        finishedAtUnix: 220,
        exitCode: 0,
        steps: [],
      },
    ).needsAttention).toBe(false);
  });

  it('maps current and retained job summaries for runtime context', () => {
    const lastTest = {
      jobKind: 'test' as const,
      command: 'test' as const,
      status: 'failed' as const,
      startedAtUnix: 100,
      finishedAtUnix: 120,
      exitCode: 1,
      steps: [],
    };
    expect(lastTestForRuntime({
      status: 'idle',
      steps: [],
      logs: [],
      lastTest,
    })).toBe(lastTest);
    expect(lastBuildForRuntime({
      status: 'succeeded',
      jobKind: 'build',
      command: 'package',
      startedAtUnix: 100,
      finishedAtUnix: 120,
      exitCode: 0,
      steps: [],
      logs: [],
    })?.command).toBe('package');
  });
});
