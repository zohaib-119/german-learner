export type EngineId = 'piper' | 'edge';

export interface SpeakOptions {
  /** 1 = normal, 0.75 = slow. */
  rate?: number;
  /** Aborting stops playback; speak() then resolves normally (it is not an error). */
  signal?: AbortSignal;
}

export interface TtsEngine {
  readonly id: EngineId;
  readonly label: string;
  /** Whether this engine can currently produce German audio. */
  isAvailable(): Promise<boolean>;
  /** Resolves when playback ends or is aborted; rejects if audio could not be produced. */
  speak(text: string, opts?: SpeakOptions): Promise<void>;
  /** Generate/cache audio ahead of time. */
  prepare?(texts: string[], onProgress?: (done: number, total: number) => void, signal?: AbortSignal): Promise<void>;
}

export class NoAudioError extends Error {
  constructor(public readonly causes: { engine: EngineId; error: unknown }[]) {
    super(
      'Audio unavailable. Start the TTS service (npm run tts). ' +
        causes.map((c) => `${c.engine}: ${c.error instanceof Error ? c.error.message : String(c.error)}`).join('; '),
    );
    this.name = 'NoAudioError';
  }
}
