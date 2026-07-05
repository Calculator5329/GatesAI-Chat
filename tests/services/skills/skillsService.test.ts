import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SKILL_INSTRUCTIONS_MAX_CHARS,
  loadWorkspaceSkills,
  parseWorkspaceSkillFile,
} from '../../../src/services/skills/skillsService';
import type { SkillsBridgeFacade } from '../../../src/services/skills/skillsService';

describe('skillsService', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('parses full frontmatter and reports unknown tools', () => {
    const skill = parseWorkspaceSkillFile('/workspace/skills/code-reviewer.md', [
      '---',
      'name: code-reviewer',
      'description: Reviews code rigorously',
      'tools: fs, terminal, git, made-up',
      '---',
      'Review one finding at a time.',
    ].join('\n'), { knownToolNames: ['fs', 'terminal', 'git', 'thread'] });

    expect(skill).toMatchObject({
      id: 'code-reviewer',
      name: 'code-reviewer',
      description: 'Reviews code rigorously',
      tools: ['fs', 'terminal', 'git', 'made-up'],
      instructions: 'Review one finding at a time.',
    });
    expect(skill.warnings).toEqual(['Unknown tool: made-up.']);
  });

  it('parses partial frontmatter with omitted tool allowlist', () => {
    const skill = parseWorkspaceSkillFile('/workspace/skills/planner.md', [
      '---',
      'name: planner',
      '---',
      'Plan before coding.',
    ].join('\n'));

    expect(skill.name).toBe('planner');
    expect(skill.description).toBe('');
    expect(skill.tools).toBeUndefined();
    expect(skill.instructions).toBe('Plan before coding.');
    expect(skill.warnings).toEqual([]);
  });

  it('uses the whole file as instructions when frontmatter is absent', () => {
    const skill = parseWorkspaceSkillFile('/workspace/skills/plain-skill.md', 'Plain instructions.');

    expect(skill.name).toBe('plain-skill');
    expect(skill.instructions).toBe('Plain instructions.');
    expect(skill.warnings).toEqual([]);
  });

  it('tolerates malformed frontmatter and warns', () => {
    const skill = parseWorkspaceSkillFile('/workspace/skills/broken.md', [
      '---',
      'name broken',
      'No closing fence.',
    ].join('\n'));

    expect(skill.name).toBe('broken');
    expect(skill.instructions).toContain('No closing fence.');
    expect(skill.warnings).toContain('Bad frontmatter: missing closing ---.');
  });

  it('validates slug names and truncates instructions to 8k including the note', () => {
    const skill = parseWorkspaceSkillFile('/workspace/skills/BadName.md', [
      '---',
      'name: BadName',
      '---',
      'x'.repeat(SKILL_INSTRUCTIONS_MAX_CHARS + 100),
    ].join('\n'));

    expect(skill.instructions).toHaveLength(SKILL_INSTRUCTIONS_MAX_CHARS);
    expect(skill.instructions).toContain('truncated');
    expect(skill.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('Invalid skill name'),
      expect.stringContaining('were truncated'),
    ]));
  });

  it('loads markdown skills through bridge fs and skips README.md', async () => {
    const bridge = memoryBridge({
      '/workspace/skills/code-reviewer.md': '---\nname: code-reviewer\n---\nReview.',
      '/workspace/skills/README.md': '# docs',
    });

    const skills = await loadWorkspaceSkills(bridge, { knownToolNames: ['thread'] });

    expect(skills.map(skill => skill.name)).toEqual(['code-reviewer']);
    expect(bridge.calls.map(call => call.op)).toEqual(['fs.list', 'fs.read']);
  });

  it('does not call the bridge in Web Lite', async () => {
    vi.stubEnv('VITE_GATESAI_WEB', '1');
    const bridge = memoryBridge({ '/workspace/skills/code-reviewer.md': 'Review.' });

    await expect(loadWorkspaceSkills(bridge)).resolves.toEqual([]);
    expect(bridge.calls).toEqual([]);
  });
});

function memoryBridge(files: Record<string, string>): SkillsBridgeFacade & { calls: Array<{ op: string; data: unknown }> } {
  const calls: Array<{ op: string; data: unknown }> = [];
  return {
    isOnline: true,
    calls,
    client: {
      async request<T = unknown>(op: string, data: unknown): Promise<T> {
        calls.push({ op, data });
        if (op === 'fs.list') {
          return {
            path: '/workspace/skills',
            entries: Object.keys(files).map(path => ({
              path,
              name: path.split('/').pop() ?? path,
              kind: 'file',
              size: files[path].length,
              mtime: 1,
            })),
          } as T;
        }
        if (op === 'fs.read') {
          const path = (data as { path: string }).path;
          return {
            path,
            content: files[path],
            encoding: 'utf8',
            size: files[path]?.length ?? 0,
            mime: 'text/markdown',
          } as T;
        }
        throw new Error(`unexpected op ${op}`);
      },
    },
  };
}
