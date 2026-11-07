import type { EngineId } from './engine';
import { speakWithFallback } from './fallback';
import { buildChain, getAudioSettings } from './settings';
import { audioStatus } from './status';

export interface PlayOptions {
  slow?: boolean;
  /** Total number of plays (default 1). */
  repeat?: number;
  /** Pause between repeats in ms (default 700). */
  gapMs?: number;
}

/**
 * Single shared player: starting new audio cancels whatever is currently playing.
 * Never throws; failures are published through `audioStatus` so the UI can show one notice.
 * Resolves with the engine that spoke, or null when nothing played.
 */
class Player {
  private controller: AbortController | null = null;

  stop(): void {
    this.controller?.abort();
    this.controller = null;
  }

  async play(text: string, { slow = false, repeat = 1, gapMs = 700 }: PlayOptions = {}): Promise<EngineId | null> {
    this.stop();
    const controller = new AbortController();
    this.controller = controller;
    let used: EngineId | null = null;
    try {
      const chain = buildChain(await getAudioSettings());
      for (let i = 0; i < repeat && !controller.signal.aborted; i++) {
        used = await speakWithFallback(chain, text, { rate: slow ? 0.75 : 1, signal: controller.signal });
        audioStatus.set(null);
        if (i < repeat - 1) await sleep(gapMs, controller.signal);
      }
    } catch (e) {
      if (!controller.signal.aborted) audioStatus.set(e instanceof Error ? e.message : String(e));
    } finally {
      if (this.controller === controller) this.controller = null;
    }
    return used;
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

export const player = new Player();
