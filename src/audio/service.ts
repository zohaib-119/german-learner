import { TTS_URL } from './config';
import type { EngineId, SpeakOptions, TtsEngine } from './engine';

export interface ServiceHealth {
  ok: boolean;
  engines: Record<EngineId, { available: boolean; voices: string[]; default: string }>;
  cached_files: number;
}

/** Fetch /health with a short timeout. Returns null when the service is not running. */
export async function fetchHealth(timeoutMs = 1500): Promise<ServiceHealth | null> {
  try {
    const r = await fetch(`${TTS_URL}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok ? ((await r.json()) as ServiceHealth) : null;
  } catch {
    return null;
  }
}

/** Piper or edge-tts via the local tts-service. The browser HTTP cache plus the server's disk cache make repeats free. */
export class ServiceEngine implements TtsEngine {
  readonly label: string;

  constructor(
    readonly id: EngineId,
    private voice?: string,
  ) {
    this.label = id === 'piper' ? 'Piper' : 'Edge';
  }

  url(text: string): string {
    const p = new URLSearchParams({ text, engine: this.id });
    if (this.voice) p.set('voice', this.voice);
    return `${TTS_URL}/tts?${p}`;
  }

  async isAvailable(): Promise<boolean> {
    return !!(await fetchHealth())?.engines[this.id]?.available;
  }

  async speak(text: string, opts: SpeakOptions = {}): Promise<void> {
    if (opts.signal?.aborted) return;
    const audio = new Audio(this.url(text));
    audio.preservesPitch = true;
    audio.playbackRate = opts.rate ?? 1;
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        audio.onended = audio.onerror = null;
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      };
      audio.onended = () => {
        cleanup();
        resolve();
      };
      audio.onerror = () => {
        cleanup();
        reject(new Error('could not load audio'));
      };
      opts.signal?.addEventListener(
        'abort',
        () => {
          cleanup();
          resolve();
        },
        { once: true },
      );
      audio.play().catch((e) => {
        cleanup();
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }

  /** Request each text once so it is synthesized and cached server-side (2 at a time). */
  async prepare(texts: string[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<void> {
    const unique = [...new Set(texts)];
    let done = 0;
    let next = 0;
    const worker = async () => {
      while (next < unique.length && !signal?.aborted) {
        const text = unique[next++]!;
        const r = await fetch(this.url(text), signal ? { signal } : {});
        if (!r.ok) throw new Error(`tts-service returned ${r.status}`);
        await r.arrayBuffer();
        onProgress?.(++done, unique.length);
      }
    };
    await Promise.all([worker(), worker()]);
  }
}
