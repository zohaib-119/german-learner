import { cleanCueText, isSoundAnnotation, type Cue } from './subtitles';

/** A readable subtitle line: one or more raw cues merged into a sentence-sized unit. */
export interface Line {
  start: number;
  end: number;
  text: string;
}

export interface LineOptions {
  /** Close a line once it is this long (characters). */
  maxChars?: number;
  /** Close a line once it spans this many seconds. */
  maxSeconds?: number;
  /** A sentence-ending cue closes the line only after this many seconds. */
  minSeconds?: number;
  /** A pause longer than this between cues starts a new line. */
  gapSeconds?: number;
  /** Assumed duration of the very last cue when no end time is known. */
  lastCueSeconds?: number;
}

const SENTENCE_END = /[.!?…]["')»”]?$/;

/**
 * Merges the short, fragmentary cues YouTube produces (often 2-4 seconds, no punctuation)
 * into lines that are comfortable to read and translate. Times are preserved exactly:
 * a line starts when its first cue starts and ends when its last cue ends.
 */
export function mergeCues(cues: Cue[], options: LineOptions = {}): Line[] {
  const { maxChars = 90, maxSeconds = 8, minSeconds = 1.5, gapSeconds = 1.5, lastCueSeconds = 3 } = options;
  const clean = cues
    .map((c) => ({ ...c, text: cleanCueText(c.text) }))
    .filter((c) => c.text && !isSoundAnnotation(c.text))
    .sort((a, b) => a.start - b.start);

  const ends = clean.map((c, i) => {
    const next = clean[i + 1];
    if (c.end !== undefined && c.end > c.start) return next ? Math.min(c.end, Math.max(next.start, c.start + 0.3)) : c.end;
    if (next) return Math.min(next.start, c.start + maxSeconds);
    return c.start + lastCueSeconds;
  });

  const lines: Line[] = [];
  let cur: Line | null = null;
  clean.forEach((c, i) => {
    const end = ends[i]!;
    if (cur) {
      const gap = c.start - cur.end;
      const wouldBe = cur.text.length + 1 + c.text.length;
      const closed = SENTENCE_END.test(cur.text) && cur.end - cur.start >= minSeconds;
      if (gap > gapSeconds || wouldBe > maxChars || end - cur.start > maxSeconds || closed) {
        lines.push(cur);
        cur = null;
      }
    }
    if (!cur) cur = { start: c.start, end, text: c.text };
    else {
      cur.text += ` ${c.text}`;
      cur.end = end;
    }
  });
  if (cur) lines.push(cur);
  return lines;
}
