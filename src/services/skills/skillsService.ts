import type { FsListResp, FsReadResp } from '../../core/workspace';
import { isWebLite } from '../../core/runtime';

export const WORKSPACE_SKILLS_DIR = '/workspace/skills';
export const WORKSPACE_SKILLS_README_PATH = `${WORKSPACE_SKILLS_DIR}/README.md`;
export const SKILL_INSTRUCTIONS_MAX_CHARS = 8000;
const SKILL_TRUNCATION_NOTE = '\n\n[Workspace skill instructions truncated.]';
const SKILL_NAME_RE = /^[a-z0-9-]{1,40}$/;

export interface SkillsBridgeFacade {
  readonly isOnline: boolean;
  readonly client: {
    request<T = unknown>(op: string, data: unknown): Promise<T>;
  };
}

export interface WorkspaceSkill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  tools?: string[];
  path: string;
  warnings: string[];
}

export interface ParseWorkspaceSkillOptions {
  knownToolNames?: Iterable<string>;
}

export async function loadWorkspaceSkills(
  bridge: SkillsBridgeFacade | undefined,
  options: ParseWorkspaceSkillOptions = {},
): Promise<WorkspaceSkill[]> {
  if (isWebLite() || !bridge?.isOnline) return [];

  let list: FsListResp;
  try {
    list = await bridge.client.request<FsListResp>('fs.list', { path: WORKSPACE_SKILLS_DIR, recursive: false });
  } catch {
    return [];
  }

  const files = list.entries
    .filter(entry => entry.kind === 'file' && /\.md$/i.test(entry.name) && entry.name.toLowerCase() !== 'readme.md')
    .sort((a, b) => a.name.localeCompare(b.name));

  const skills: WorkspaceSkill[] = [];
  for (const file of files) {
    try {
      const read = await bridge.client.request<FsReadResp>('fs.read', { path: file.path, encoding: 'utf8' });
      skills.push(parseWorkspaceSkillFile(file.path, read.content, options));
    } catch {
      skills.push({
        id: filenameStem(file.path),
        name: filenameStem(file.path),
        description: '',
        instructions: '',
        path: file.path,
        warnings: ['Could not read skill file.'],
      });
    }
  }
  return skills;
}

export function parseWorkspaceSkillFile(
  path: string,
  raw: string,
  options: ParseWorkspaceSkillOptions = {},
): WorkspaceSkill {
  const warnings: string[] = [];
  const fallbackName = filenameStem(path);
  const parsed = parseFrontmatter(raw, warnings);
  const fields = parsed.fields;
  const name = (fields.name ?? fallbackName).trim();
  const description = (fields.description ?? '').trim();
  const tools = parseTools(fields.tools);
  const knownToolNames = options.knownToolNames ? new Set(options.knownToolNames) : null;

  if (!SKILL_NAME_RE.test(name)) {
    warnings.push(`Invalid skill name "${name || fallbackName}". Use [a-z0-9-] and 1-40 characters.`);
  }

  if (tools && knownToolNames) {
    const unknown = tools.filter(tool => !knownToolNames.has(tool));
    if (unknown.length > 0) warnings.push(`Unknown tool${unknown.length === 1 ? '' : 's'}: ${unknown.join(', ')}.`);
  }

  const instructions = truncateInstructions(parsed.instructions, warnings);
  return {
    id: name,
    name,
    description,
    instructions,
    ...(tools ? { tools } : {}),
    path,
    warnings,
  };
}

export function appendSkillInstructionsToSystemPrompt(
  systemPrompt: string | undefined,
  skill: Pick<WorkspaceSkill, 'name' | 'instructions'> | undefined,
): string | undefined {
  if (!skill) return systemPrompt;
  const instructions = skill.instructions.trim();
  if (!instructions) return systemPrompt;
  const block = [
    `--- Workspace skill: ${skill.name} ---`,
    instructions,
    '--- End workspace skill ---',
  ].join('\n');
  return systemPrompt?.trim() ? `${systemPrompt}\n\n${block}` : block;
}

function parseFrontmatter(raw: string, warnings: string[]): { fields: Record<string, string>; instructions: string } {
  const normalized = raw.replace(/^\uFEFF/, '');
  if (!normalized.startsWith('---')) return { fields: {}, instructions: raw };
  const firstBreak = normalized.indexOf('\n');
  if (firstBreak < 0) {
    warnings.push('Bad frontmatter: missing closing ---.');
    return { fields: {}, instructions: raw };
  }
  const closing = findClosingFence(normalized, firstBreak + 1);
  if (closing < 0) {
    warnings.push('Bad frontmatter: missing closing ---.');
    return { fields: {}, instructions: raw };
  }

  const fields: Record<string, string> = {};
  const header = normalized.slice(firstBreak + 1, closing);
  for (const [index, line] of header.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon <= 0) {
      warnings.push(`Bad frontmatter line ${index + 1}: expected key: value.`);
      continue;
    }
    const key = trimmed.slice(0, colon).trim();
    const value = trimmed.slice(colon + 1).trim();
    if (key === 'name' || key === 'description' || key === 'tools') {
      fields[key] = stripInlineComment(value).trim();
    } else {
      warnings.push(`Unknown frontmatter field "${key}".`);
    }
  }

  const afterFence = normalized.slice(closing);
  const nextBreak = afterFence.indexOf('\n');
  const instructions = nextBreak >= 0 ? afterFence.slice(nextBreak + 1) : '';
  return { fields, instructions };
}

function findClosingFence(raw: string, from: number): number {
  const match = /\r?\n---\s*(?:\r?\n|$)/g;
  match.lastIndex = Math.max(0, from - 1);
  const found = match.exec(raw);
  return found ? found.index + found[0].match(/^\r?\n/)![0].length : -1;
}

function stripInlineComment(value: string): string {
  const hash = value.indexOf('#');
  return hash >= 0 ? value.slice(0, hash) : value;
}

function parseTools(value: string | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  const tools = value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
  return tools.length > 0 ? [...new Set(tools)] : undefined;
}

function truncateInstructions(value: string, warnings: string[]): string {
  if (value.length <= SKILL_INSTRUCTIONS_MAX_CHARS) return value;
  const headLength = Math.max(0, SKILL_INSTRUCTIONS_MAX_CHARS - SKILL_TRUNCATION_NOTE.length);
  warnings.push(`Instructions exceeded ${SKILL_INSTRUCTIONS_MAX_CHARS} characters and were truncated.`);
  return `${value.slice(0, headLength)}${SKILL_TRUNCATION_NOTE}`;
}

function filenameStem(path: string): string {
  const name = path.split('/').pop() ?? path;
  return name.replace(/\.md$/i, '');
}
