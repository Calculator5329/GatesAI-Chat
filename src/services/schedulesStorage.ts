import type { Schedule, SchedulesSnapshot } from '../core/schedules';
import { normalizeScheduleCadence } from '../core/schedules';
import { createJsonPersistenceProvider, type KeyValuePersistence } from './storage/persistenceProvider';

const SCHEDULES_KEY = 'gatesai.schedules.v1';

function parseSchedule(value: unknown): Schedule | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<Schedule>;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.title !== 'string' || !raw.title.trim()) return null;
  if (typeof raw.instructions !== 'string' || !raw.instructions.trim()) return null;
  if (typeof raw.createdAt !== 'number' || !Number.isFinite(raw.createdAt)) return null;
  return {
    id: raw.id,
    title: raw.title,
    instructions: raw.instructions,
    ...(typeof raw.model === 'string' && raw.model ? { model: raw.model } : {}),
    cadence: normalizeScheduleCadence(raw.cadence),
    enabled: raw.enabled !== false,
    catchUp: raw.catchUp === true,
    ...(typeof raw.lastRunAt === 'number' && Number.isFinite(raw.lastRunAt) ? { lastRunAt: raw.lastRunAt } : {}),
    ...(typeof raw.lastResultThreadId === 'string' && raw.lastResultThreadId ? { lastResultThreadId: raw.lastResultThreadId } : {}),
    createdAt: raw.createdAt,
  };
}

export function parseSchedulesSnapshot(value: unknown): SchedulesSnapshot {
  if (!value || typeof value !== 'object') return { schedules: [] };
  const raw = value as Partial<SchedulesSnapshot>;
  if (!Array.isArray(raw.schedules)) return { schedules: [] };
  return { schedules: raw.schedules.map(parseSchedule).filter((item): item is Schedule => item != null) };
}

export function createSchedulesPersistenceProvider(storage?: KeyValuePersistence) {
  return createJsonPersistenceProvider<SchedulesSnapshot>({
    key: SCHEDULES_KEY,
    parse: parseSchedulesSnapshot,
    storage,
  });
}

export const schedulesPersistence = createSchedulesPersistenceProvider();
