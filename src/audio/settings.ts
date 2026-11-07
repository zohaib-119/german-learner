import { db } from '../db';
import type { EngineId, TtsEngine } from './engine';
import { ServiceEngine } from './service';
import { WebSpeechEngine } from './webspeech';

export interface AudioSettings {
  engine: EngineId;
  serviceUrl: string;
  piperVoice: string;
  edgeVoice: string;
  webVoiceURI: string;
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  engine: 'webspeech',
  serviceUrl: 'http://localhost:8787',
  piperVoice: 'de_DE-thorsten-high',
  edgeVoice: 'de-DE-KatjaNeural',
  webVoiceURI: '',
};

const KEY = 'audio';
let cache: AudioSettings | null = null;

export async function getAudioSettings(): Promise<AudioSettings> {
  if (cache) return cache;
  try {
    const row = await db.settings.get(KEY);
    cache = { ...DEFAULT_AUDIO_SETTINGS, ...((row?.value as Partial<AudioSettings>) ?? {}) };
  } catch {
    cache = { ...DEFAULT_AUDIO_SETTINGS };
  }
  return cache;
}

export async function saveAudioSettings(patch: Partial<AudioSettings>): Promise<AudioSettings> {
  const next = { ...(await getAudioSettings()), ...patch };
  cache = next;
  await db.settings.put({ key: KEY, value: next });
  return next;
}

export function makeEngine(id: EngineId, s: AudioSettings): TtsEngine {
  switch (id) {
    case 'webspeech':
      return new WebSpeechEngine(s.webVoiceURI || undefined);
    case 'piper':
      return new ServiceEngine('piper', s.serviceUrl, s.piperVoice);
    case 'edge':
      return new ServiceEngine('edge', s.serviceUrl, s.edgeVoice);
  }
}

/** Selected engine first, then Web Speech as the last resort. */
export function buildChain(s: AudioSettings): TtsEngine[] {
  const chain = [makeEngine(s.engine, s)];
  if (s.engine !== 'webspeech') chain.push(makeEngine('webspeech', s));
  return chain;
}
