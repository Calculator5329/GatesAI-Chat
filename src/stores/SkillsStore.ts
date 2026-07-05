import { makeAutoObservable, runInAction } from 'mobx';
import { isWebLite } from '../core/runtime';
import { loadWorkspaceSkills, type SkillsBridgeFacade, type WorkspaceSkill } from '../services/skills/skillsService';

export type { WorkspaceSkill } from '../services/skills/skillsService';

export class SkillsStore {
  skills: WorkspaceSkill[] = [];
  loading = false;
  lastError: string | null = null;

  private readonly bridge: SkillsBridgeFacade;
  private readonly knownToolNames: () => string[];

  constructor(bridge: SkillsBridgeFacade, knownToolNames: () => string[]) {
    this.bridge = bridge;
    this.knownToolNames = knownToolNames;
    makeAutoObservable<this, 'bridge' | 'knownToolNames'>(this, {
      bridge: false,
      knownToolNames: false,
    });
  }

  get count(): number {
    return this.skills.length;
  }

  findById(id: string | null | undefined): WorkspaceSkill | undefined {
    if (!id) return undefined;
    return this.skills.find(skill => skill.id === id);
  }

  async refresh(): Promise<void> {
    if (isWebLite()) {
      runInAction(() => {
        this.skills = [];
        this.loading = false;
        this.lastError = null;
      });
      return;
    }
    if (!this.bridge.isOnline) {
      runInAction(() => {
        this.skills = [];
        this.loading = false;
        this.lastError = null;
      });
      return;
    }

    this.loading = true;
    this.lastError = null;
    try {
      const skills = await loadWorkspaceSkills(this.bridge, { knownToolNames: this.knownToolNames() });
      runInAction(() => {
        this.skills = skills;
        this.loading = false;
      });
    } catch (err) {
      runInAction(() => {
        this.skills = [];
        this.loading = false;
        this.lastError = (err as Error).message;
      });
    }
  }
}
