/**
 * Persistence for the user profile (memory + default instructions).
 * Kept in its own localStorage slot, separate from chat snapshots and
 * provider keys, so it survives chat history clears.
 */

export interface UserProfileSnapshot {
  bio: string;
  defaultSystemPrompt: string;
}

const KEY = 'gatesai.profile.v1';

export function loadProfile(): UserProfileSnapshot {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { bio: '', defaultSystemPrompt: '' };
    const parsed = JSON.parse(raw) as Partial<UserProfileSnapshot>;
    return {
      bio: typeof parsed.bio === 'string' ? parsed.bio : '',
      defaultSystemPrompt: typeof parsed.defaultSystemPrompt === 'string' ? parsed.defaultSystemPrompt : '',
    };
  } catch {
    return { bio: '', defaultSystemPrompt: '' };
  }
}

export function saveProfile(snap: UserProfileSnapshot): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(snap));
  } catch {
    // ignore quota / privacy-mode failures
  }
}
