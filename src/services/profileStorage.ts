/**
 * Persistence for the user profile (memory + default instructions).
 * Kept in its own localStorage slot, separate from chat snapshots and
 * provider keys, so it survives chat history clears.
 */

import { jsonSlot } from './storage/jsonSlot';

export interface UserProfileSnapshot {
  bio: string;
  defaultSystemPrompt: string;
}

export const profilePersistence = jsonSlot<UserProfileSnapshot>('gatesai.profile.v1', raw => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<UserProfileSnapshot>;
  return {
    bio: typeof r.bio === 'string' ? r.bio : '',
    defaultSystemPrompt: typeof r.defaultSystemPrompt === 'string' ? r.defaultSystemPrompt : '',
  };
});

export const loadProfile = profilePersistence.load;
export const saveProfile = profilePersistence.save;
