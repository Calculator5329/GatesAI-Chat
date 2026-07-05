import type { SourceChangedFiles } from '../services/sourceWorkspace';
import type { SourceBuildJobSummary, SourceBuildStatus } from '../services/sourceBuild';

export interface SourceTestFreshness {
  passedSinceLatestChange: boolean;
  needsAttention: boolean;
  label: string;
}

export function sourceTestFreshness(
  changedFiles: SourceChangedFiles | null | undefined,
  lastTest: SourceBuildJobSummary | null | undefined,
): SourceTestFreshness {
  const latestChange = changedFiles?.latestChangeAtUnix;
  if (!latestChange) {
    return {
      passedSinceLatestChange: lastTest?.status === 'succeeded',
      needsAttention: false,
      label: lastTest?.status === 'succeeded' ? 'tests passed' : 'no changed files',
    };
  }
  if (lastTest?.status === 'succeeded' && (lastTest.finishedAtUnix ?? 0) >= latestChange) {
    return { passedSinceLatestChange: true, needsAttention: false, label: 'tests passed since the last edit' };
  }
  return { passedSinceLatestChange: false, needsAttention: true, label: "tests haven't passed since the last edit" };
}

export function lastBuildForRuntime(status: SourceBuildStatus | null | undefined): SourceBuildJobSummary | undefined {
  if (status?.lastBuild) return status.lastBuild;
  if (status?.jobKind === 'build' && status.command) return summaryFromStatus(status);
  return undefined;
}

export function lastTestForRuntime(status: SourceBuildStatus | null | undefined): SourceBuildJobSummary | undefined {
  if (status?.lastTest) return status.lastTest;
  if (status?.jobKind === 'test' && status.command === 'test') return summaryFromStatus(status);
  return undefined;
}

function summaryFromStatus(status: SourceBuildStatus): SourceBuildJobSummary {
  return {
    jobKind: status.jobKind ?? 'build',
    command: status.command ?? 'build',
    status: status.status,
    startedAtUnix: status.startedAtUnix,
    finishedAtUnix: status.finishedAtUnix,
    exitCode: status.exitCode,
    steps: status.steps,
  };
}
