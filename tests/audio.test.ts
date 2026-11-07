import { describe, expect, it } from 'vitest';
import { NoAudioError, type EngineId, type SpeakOptions, type TtsEngine } from '../src/audio/engine';
import { speakWithFallback } from '../src/audio/fallback';
import { lessonTexts, spokenText } from '../src/audio/texts';

function fake(id: EngineId, impl: (text: string, opts: SpeakOptions) => Promise<void>): TtsEngine & { calls: string[] } {
  const calls: string[] = [];
  return {
    id,
    label: id,
    calls,
    isAvailable: async () => true,
    speak: async (t, o = {}) => {
      calls.push(t);
      await impl(t, o);
    },
  };
}

describe('speakWithFallback', () => {
  it('uses the first engine when it works', async () => {
    const a = fake('piper', async () => {});
    const b = fake('edge', async () => {});
    expect(await speakWithFallback([a, b], 'Hallo')).toBe('piper');
    expect(b.calls).toEqual([]);
  });

  it('falls through to the next engine on error', async () => {
    const a = fake('piper', async () => {
      throw new Error('service down');
    });
    const b = fake('edge', async () => {});
    expect(await speakWithFallback([a, b], 'Hallo')).toBe('edge');
  });

  it('throws NoAudioError listing every cause when all fail', async () => {
    const boom = (m: string) => async () => {
      throw new Error(m);
    };
    const err = await speakWithFallback([fake('piper', boom('x')), fake('edge', boom('y'))], 'Hi').catch((e) => e);
    expect(err).toBeInstanceOf(NoAudioError);
    expect(err.message).toMatch(/piper: x.*edge: y/);
  });

  it('does not try the next engine after the caller aborted', async () => {
    const c = new AbortController();
    const a = fake('piper', async () => {
      c.abort();
      throw new Error('interrupted');
    });
    const b = fake('edge', async () => {});
    await speakWithFallback([a, b], 'Hi', { signal: c.signal });
    expect(b.calls).toEqual([]);
  });
});

describe('lessonTexts', () => {
  it('uses tts override, includes example sentences, and de-duplicates', () => {
    const items = [
      { id: 'a', kind: 'phrase', de: 'Ich hätte gern …', en: 'x', tts: 'Ich hätte gern' },
      { id: 'b', kind: 'noun', de: 'Brot', en: 'bread', example: { de: 'Ein Brot, bitte.' } },
      { id: 'c', kind: 'noun', de: 'Brot', en: 'bread again' },
    ] as never;
    expect(spokenText({ de: 'A', tts: 'B' })).toBe('B');
    expect(lessonTexts({ items })).toEqual(['Ich hätte gern', 'Brot', 'Ein Brot, bitte.']);
    const exercises = [
      { type: 'fill_blank', id: 'a', prompt: 'Ich ___ Brot.', answer: 'esse', accept: [] },
      { type: 'multiple_choice', id: 'b', prompt: 'p', options: ['x', 'Ich esse.'], correct: 1 },
    ] as never;
    expect(lessonTexts({ items, exercises })).toContain('Ich esse Brot.');
    expect(lessonTexts({ items, exercises })).toContain('Ich esse.');
  });
});
