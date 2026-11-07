import type { EngineId } from './engine';
import { speakWithFallback } from './fallback';
import { buildChain, getAudioSettings } from './settings';

export interface PlayOptions {
  slow?: boolean;
  /** Total number of plays (default 1). */
  repeat?: number;
  /** Pause between repeats in ms (default 700). */
  gapMs?: number;
}

/**
 * Single shared player: starting new audio cancels whatever is currently playing.
 * Resolves with the engine that was used (so the UI can show which one actually spoke).
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
    const chain = buildChain(await getAudioSettings());
    let used: EngineId | null = null;
    try {
      for (let i = 0; i < repeat && !controller.signal.aborted; i++) {
        used = await speakWithFallback(chain, text, { rate: slow ? 0.75 : 1, signal: controller.signal });
        if (i < repeat - 1) await sleep(gapMs, controller.signal);
      }
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
