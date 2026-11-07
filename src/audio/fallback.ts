import { NoAudioError, type EngineId, type SpeakOptions, type TtsEngine } from './engine';

/**
 * Try each engine in order until one plays. Returns the id of the engine that worked.
 * If playback was aborted by the caller, stop immediately instead of trying the next engine.
 */
export async function speakWithFallback(chain: TtsEngine[], text: string, opts: SpeakOptions = {}): Promise<EngineId> {
  const causes: { engine: EngineId; error: unknown }[] = [];
  for (const engine of chain) {
    if (opts.signal?.aborted) return engine.id;
    try {
      await engine.speak(text, opts);
      return engine.id;
    } catch (error) {
      if (opts.signal?.aborted) return engine.id;
      causes.push({ engine: engine.id, error });
    }
  }
  throw new NoAudioError(causes);
}
