import type { SpeakOptions, TtsEngine } from './engine';

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

/** getVoices() is empty until the browser has loaded them (async in Chrome). */
export function loadVoices(timeoutMs = 1500): Promise<SpeechSynthesisVoice[]> {
  const s = synth();
  if (!s) return Promise.resolve([]);
  const now = s.getVoices();
  if (now.length) return Promise.resolve(now);
  return new Promise((resolve) => {
    const finish = () => {
      s.removeEventListener('voiceschanged', finish);
      resolve(s.getVoices());
    };
    s.addEventListener('voiceschanged', finish);
    setTimeout(finish, timeoutMs);
  });
}

export async function germanVoices(): Promise<SpeechSynthesisVoice[]> {
  const all = await loadVoices();
  return all.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('de')).sort((a, b) => score(b) - score(a));
}

/** Prefer neural/"Natural" (Edge) and Google voices over basic local ones. */
function score(v: SpeechSynthesisVoice): number {
  const n = v.name.toLowerCase();
  let s = 0;
  if (n.includes('natural')) s += 10;
  if (n.includes('online')) s += 5;
  if (n.includes('google')) s += 4;
  if (n.includes('espeak')) s -= 10;
  if (v.lang.toLowerCase().replace('_', '-') === 'de-de') s += 1;
  return s;
}

export class WebSpeechEngine implements TtsEngine {
  readonly id = 'webspeech' as const;
  readonly label = 'Browser (Web Speech)';
  constructor(private voiceURI?: string) {}

  async isAvailable(): Promise<boolean> {
    return (await germanVoices()).length > 0;
  }

  async speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    const s = synth();
    if (!s) throw new Error('Web Speech API not supported in this browser');
    const voices = await germanVoices();
    if (voices.length === 0) throw new Error('no German voice installed in this browser/OS');
    const voice = voices.find((v) => v.voiceURI === this.voiceURI) ?? voices[0]!;

    await new Promise<void>((resolve, reject) => {
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.rate = opts.rate ?? 1;
      u.onend = () => resolve();
      u.onerror = (e) => {
        // "canceled"/"interrupted" happen when we stop on purpose.
        if (e.error === 'canceled' || e.error === 'interrupted') resolve();
        else reject(new Error(`speech error: ${e.error}`));
      };
      opts.signal?.addEventListener(
        'abort',
        () => {
          s.cancel();
          resolve();
        },
        { once: true },
      );
      s.cancel(); // clear anything queued
      s.speak(u);
    });
  }
}
