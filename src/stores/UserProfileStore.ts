import { autorun, makeAutoObservable, toJS } from 'mobx';
import { loadProfile, saveProfile, type UserProfileSnapshot } from '../services/profileStorage';

/**
 * The user's persistent context — facts about them and a default
 * system prompt. Both compose into a single system message on every
 * turn (see {@link composeSystemPrompt}).
 *
 * Storage: bio is stored as a single newline-separated string (one fact
 * per line, optional `· ` prefix) so it round-trips cleanly through the
 * Agent textarea. The {@link facts} getter parses it into an array for
 * tool actions and the profile UI; {@link bioFromFacts} re-serializes.
 */
export class UserProfileStore {
  bio = '';
  defaultSystemPrompt = '';

  constructor() {
    const snap = loadProfile();
    this.bio = snap.bio;
    this.defaultSystemPrompt = snap.defaultSystemPrompt;
    makeAutoObservable(this);
    autorun(() => saveProfile(toJS(this.snapshot)));
  }

  get snapshot(): UserProfileSnapshot {
    return { bio: this.bio, defaultSystemPrompt: this.defaultSystemPrompt };
  }

  /** Parsed view of the bio. Order = display order (newest first by convention). */
  get facts(): string[] {
    return this.bio
      .split('\n')
      .map(line => stripBullet(line.trim()))
      .filter(line => line.length > 0);
  }

  setBio(value: string): void { this.bio = value; }
  setDefaultSystemPrompt(value: string): void { this.defaultSystemPrompt = value; }

  /**
   * Prepend a single fact. New facts go to the top so the most recent
   * context is the most prominent when the model re-reads its memory.
   * No-op for empty input or exact duplicates of an existing fact (case-
   * insensitive) — the model occasionally re-fires the same save.
   */
  addFact(fact: string): boolean {
    const trimmed = stripBullet(fact.trim());
    if (!trimmed) return false;
    const existing = this.facts;
    if (existing.some(f => f.toLowerCase() === trimmed.toLowerCase())) return false;
    this.bio = bioFromFacts([trimmed, ...existing]);
    return true;
  }

  /**
   * Remove a fact by index (preferred; matches the list returned by
   * {@link facts}). Returns the removed fact for confirmation, or null.
   */
  removeFactAt(index: number): string | null {
    const list = this.facts;
    if (index < 0 || index >= list.length) return null;
    const removed = list[index];
    list.splice(index, 1);
    this.bio = bioFromFacts(list);
    return removed;
  }

  /**
   * Remove the first fact whose lowercase substring matches `match`.
   * Used by the model when it asks to forget something by description
   * rather than by index. Returns the removed fact, or null if no match.
   */
  removeFactMatching(match: string): string | null {
    const needle = match.trim().toLowerCase();
    if (!needle) return null;
    const list = this.facts;
    const idx = list.findIndex(f => f.toLowerCase().includes(needle));
    if (idx < 0) return null;
    return this.removeFactAt(idx);
  }

  /** Replace the fact at `index`. Returns the new value or null on bad input. */
  updateFactAt(index: number, next: string): string | null {
    const list = this.facts;
    if (index < 0 || index >= list.length) return null;
    const trimmed = stripBullet(next.trim());
    if (!trimmed) return null;
    list[index] = trimmed;
    this.bio = bioFromFacts(list);
    return trimmed;
  }

  /**
   * Find a fact by substring and replace it. Returns the new value or null.
   * The match is the same logic as {@link removeFactMatching}.
   */
  updateFactMatching(match: string, next: string): string | null {
    const needle = match.trim().toLowerCase();
    if (!needle) return null;
    const list = this.facts;
    const idx = list.findIndex(f => f.toLowerCase().includes(needle));
    if (idx < 0) return null;
    return this.updateFactAt(idx, next);
  }

  /** Wipe every fact. Used by the Profile UI's "Clear all" affordance. */
  clearFacts(): void { this.bio = ''; }

  /**
   * Compose the final system prompt for an outgoing request.
   *
   * Order:
   *   1. Bridge harness — always-on tool/runtime contract
   *   2. Runtime context — current time, timezone, bridge status, workspace shape
   *   3. Behavior — the global system prompt ("how you should respond")
   *   4. About the user — the persistent bio
   *   5. Recent conversations — short summaries of other threads (cross-chat awareness)
   *   6. About this conversation — the thread-scoped context (if any)
   *
   * User-authored sections are omitted when empty. The base harness is always
   * present so models understand the local bridge contract before using tools.
   *
   * The memory-tool nudge is appended whenever there's anything memory-shaped
   * in scope (existing bio or recent summaries) so the model knows it has
   * a curation tool available — keeps memory growing naturally without
   * the user having to ask "remember this" every time.
   */
  composeSystemPrompt(opts?: { runtimeContext?: string; threadContext?: string; recentSummaries?: string[] }): string | undefined {
    const head = this.defaultSystemPrompt.trim();
    const bio = this.bio.trim();
    const runtime = (opts?.runtimeContext ?? '').trim();
    const ctx = (opts?.threadContext ?? '').trim();
    const recent = (opts?.recentSummaries ?? []).map(s => s.trim()).filter(Boolean);

    const parts: string[] = [BRIDGE_HARNESS_PROMPT];
    if (runtime) parts.push(`Runtime context:\n${runtime}`);
    if (head) parts.push(head);
    if (bio) parts.push(`About the user:\n${bio}`);
    if (recent.length) {
      parts.push(`Recent conversations:\n${recent.map(s => `· ${s}`).join('\n')}`);
    }
    if (ctx) parts.push(`About this conversation:\n${ctx}`);

    // Soft nudge for proactive memory use — only when memory is actually wired
    // up (which it is whenever the tool is registered, but we gate on having
    // *some* memory context so a brand-new user without a bio doesn't get a
    // weirdly meta system message about a tool they haven't seen used yet).
    if (bio || recent.length > 0) {
      parts.push(MEMORY_TOOL_NUDGE);
    }

    return parts.join('\n\n');
  }
}

/**
 * Always-on local bridge contract. This sits above user-editable
 * instructions because it describes the runtime harness, not personality.
 */
const BRIDGE_HARNESS_PROMPT = [
  'Bridge workspace contract:',
  '- You have local workspace tools backed by the gatesai-bridge companion.',
  '- /workspace/... paths are for the `fs` tool, attachment references, and user-facing artifact locations. Do not assume /workspace exists as an absolute OS path inside scripts.',
  '- Commands run through `terminal` start in the bridge workspace root. In scripts, use Path.cwd(), process.cwd(), or relative paths to reach attachments, notes, and artifacts.',
  '- The terminal tool invokes a binary plus argv directly. Avoid shell-only syntax such as heredocs, pipes, glob expansion, or redirects unless you explicitly run an allowlisted shell.',
  '- Treat tools like command-style utilities: choose the narrow action, pass explicit arguments, read the returned status/error, then retry with corrected arguments when appropriate.',
  '- For data questions, use an artifact-first workflow: call inspect_file({ action: "workspace_profile" }) to check /workspace/artifacts for existing processed JSON summaries before opening raw files in /workspace/attachments.',
  '- Use `inspect_file` before `fs.read` for CSV, JSON, and text files. Ask for profile/preview/search/extract/aggregate results instead of loading entire data files into context.',
  '- For multiline code or substantial transforms, use `query_script` templates, write scripts under /workspace/notes/query_scripts, write reusable outputs under /workspace/artifacts, then run scripts from the workspace root.',
  '- Batch only independent tool calls. If a read/run depends on a write or generated file, do the write first, wait for its result, then run/read.',
  '- For large or bulk data work, keep data in files, generate artifacts under /workspace/artifacts, and validate with counts, ranges, schema checks, or spot checks before claiming success.',
  '- Long-running terminal commands stream progress to the UI, but you only see the final captured result. Use reasonable timeouts and wait for completion before summarizing.',
].join('\n');

/**
 * Encourages the model to use the `memory` tool proactively without being
 * explicitly asked. Mirrors how ChatGPT's hidden system prompt nudges its
 * `bio` tool. Kept terse — the tool's own description handles the details.
 */
const MEMORY_TOOL_NUDGE =
  'You have a `memory` tool. When the user mentions a durable fact about themselves in passing — preferences, identity, recurring projects, things worth remembering — proactively save it with `memory({ action: "add", fact: "…" })` and briefly tell them you saved it. When they ask you to forget something, use `action: "remove"`. Skip transient context (today\'s plans, hypothetical statements, things they ask you to forget).';

function stripBullet(line: string): string {
  return line.replace(/^[·\-*•]\s*/, '').trim();
}

function bioFromFacts(facts: string[]): string {
  return facts.map(f => `· ${f}`).join('\n');
}
