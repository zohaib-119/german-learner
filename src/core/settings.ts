import { db } from '../db';

export interface LearningSettings {
  /** New words (or new sentence items) introduced per session. */
  newPerSession: number;
  /** Treat capitalization mistakes as errors (German nouns are capitalized). */
  strictCaps: boolean;
  /** Play audio automatically when a card appears. */
  autoplay: boolean;
}

export const DEFAULT_LEARNING: LearningSettings = { newPerSession: 8, strictCaps: false, autoplay: true };

export function sanitizeLearning(raw: unknown): LearningSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const n = typeof r.newPerSession === 'number' && r.newPerSession >= 1 && r.newPerSession <= 50 ? Math.round(r.newPerSession) : DEFAULT_LEARNING.newPerSession;
  return {
    newPerSession: n,
    strictCaps: typeof r.strictCaps === 'boolean' ? r.strictCaps : DEFAULT_LEARNING.strictCaps,
    autoplay: typeof r.autoplay === 'boolean' ? r.autoplay : DEFAULT_LEARNING.autoplay,
  };
}

export async function getLearningSettings(): Promise<LearningSettings> {
  try {
    return sanitizeLearning((await db.settings.get('learning'))?.value);
  } catch {
    return { ...DEFAULT_LEARNING };
  }
}

export async function saveLearningSettings(patch: Partial<LearningSettings>): Promise<LearningSettings> {
  const next = sanitizeLearning({ ...(await getLearningSettings()), ...patch });
  await db.settings.put({ key: 'learning', value: next });
  return next;
}
