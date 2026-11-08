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

const words = (s: string) => s.split(/\s+/).filter(Boolean);
const key = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();

/**
 * Removes repeated transcript text:
 *  - the same line read twice (YouTube's page can hold the transcript list more than once),
 *  - a cue that repeats the previous one a moment later,
 *  - auto-caption overlap, where a cue starts with the last words of the previous cue.
 * Real repetitions in speech further apart in time are kept.
 */
export function dedupeCues(cues: Cue[]): Cue[] {
  const seen = new Set<string>();
  const out: Cue[] = [];
  for (const c of [...cues].sort((a, b) => a.start - b.start)) {
    const k = key(c.text);
    if (!k) continue;
    const id = `${Math.round(c.start * 10)}|${k}`;
    if (seen.has(id)) continue; // exact duplicate (same time, same text)
    seen.add(id);
    const prev = out[out.length - 1];
    if (prev) {
      const pk = key(prev.text);
      const close = c.start - prev.start < 6;
      if (close && pk === k) continue; // repeated a moment later
      if (close && k.startsWith(`${pk} `)) {
        // the new cue repeats and extends the previous one: keep only the longer one
        out[out.length - 1] = { ...c, start: prev.start };
        continue;
      }
      if (close && pk.endsWith(` ${k}`)) continue; // fully contained at the end of the previous cue
      // overlap: last words of prev == first words of this one (at least 2 words)
      const pw = words(prev.text);
      const cw = words(c.text);
      let overlap = 0;
      for (let n = Math.min(pw.length, cw.length - 1); n >= 2; n--) {
        if (key(pw.slice(-n).join(' ')) === key(cw.slice(0, n).join(' '))) {
          overlap = n;
          break;
        }
      }
      if (close && overlap) {
        out.push({ ...c, text: cw.slice(overlap).join(' ') });
        continue;
      }
    }
    out.push(c);
  }
  return out;
}

/**
 * Merges the short, fragmentary cues YouTube produces (often 2-4 seconds, no punctuation)
 * into lines that are comfortable to read and translate. Times are preserved exactly:
 * a line starts when its first cue starts and ends when its last cue ends.
 */
export function mergeCues(cues: Cue[], options: LineOptions = {}): Line[] {
  const { maxChars = 90, maxSeconds = 8, minSeconds = 1.5, gapSeconds = 1.5, lastCueSeconds = 3 } = options;
  const clean = dedupeCues(
    cues.map((c) => ({ ...c, text: cleanCueText(c.text) })).filter((c) => c.text && !isSoundAnnotation(c.text)),
  );

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
