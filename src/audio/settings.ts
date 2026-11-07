import { db } from '../db';
import type { EngineId, TtsEngine } from './engine';
import { ServiceEngine } from './service';

export interface AudioSettings {
  engine: EngineId;
  piperVoice: string;
  edgeVoice: string;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  engine: 'piper',
  piperVoice: 'de_DE-thorsten-high',
  edgeVoice: 'de-DE-KatjaNeural',
};

const KEY = 'audio';
let cache: AudioSettings | null = null;

/** Stored values from older versions (browser engine, service URL) are dropped here. */
export function sanitizeAudioSettings(raw: unknown): AudioSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, d: string) => (typeof v === 'string' && v ? v : d);
  return {
    engine: r.engine === 'edge' ? 'edge' : 'piper',
    piperVoice: str(r.piperVoice, DEFAULT_AUDIO_SETTINGS.piperVoice),
    edgeVoice: str(r.edgeVoice, DEFAULT_AUDIO_SETTINGS.edgeVoice),
  };
}

export async function getAudioSettings(): Promise<AudioSettings> {
  if (cache) return cache;
  try {
    cache = sanitizeAudioSettings((await db.settings.get(KEY))?.value);
  } catch {
    cache = { ...DEFAULT_AUDIO_SETTINGS };
  }
  return cache;
}

export async function saveAudioSettings(patch: Partial<AudioSettings>): Promise<AudioSettings> {
  const next = sanitizeAudioSettings({ ...(await getAudioSettings()), ...patch });
  cache = next;
  await db.settings.put({ key: KEY, value: next });
  return next;
}

export function makeEngine(id: EngineId, s: AudioSettings): TtsEngine {
  return new ServiceEngine(id, id === 'piper' ? s.piperVoice : s.edgeVoice);
}

/** Selected engine first, then the other one as a fallback. */
export function buildChain(s: AudioSettings): TtsEngine[] {
  const other: EngineId = s.engine === 'piper' ? 'edge' : 'piper';
  return [makeEngine(s.engine, s), makeEngine(other, s)];
}
