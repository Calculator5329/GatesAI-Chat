// Store facade over the desktop-only source-workspace and source-build services.
// Keeps the Workspace menu UI free of direct service imports: the panel calls
// these methods and owns only its transient view state. No observable state of
// its own — it is a thin, stateless bridge to the Tauri-backed services.
import {
  getSourceWorkspaceStatus,
  openSourceWorkspace,
  prepareSourceWorkspace,
  type SourceWorkspaceStatus,
} from '../services/sourceWorkspace';
import {
  clearSourceBuild,
  getSourceBuildStatus,
  startSourceBuild,
  type SourceBuildCommand,
  type SourceBuildStatus,
} from '../services/sourceBuild';

export type { SourceWorkspaceStatus } from '../services/sourceWorkspace';
export type { SourceBuildCommand, SourceBuildStatus } from '../services/sourceBuild';

export class SourceWorkspaceStore {
  status(): Promise<SourceWorkspaceStatus> { return getSourceWorkspaceStatus(); }
  prepare(): Promise<SourceWorkspaceStatus> { return prepareSourceWorkspace(); }
  open(): Promise<void> { return openSourceWorkspace(); }

  buildStatus(): Promise<SourceBuildStatus> { return getSourceBuildStatus(); }
  startBuild(command: SourceBuildCommand): Promise<SourceBuildStatus> { return startSourceBuild(command); }
  clearBuild(): Promise<SourceBuildStatus> { return clearSourceBuild(); }
}
