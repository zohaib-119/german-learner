import type { GlossEntry } from './schema';

export interface Part {
  text: string;
  /** Meaning shown on hover, when the text is a known word. */
  meaning?: string | undefined;
  /** "gloss": from this line's own glossary. "vocab": from the learner's lessons. */
  source?: 'gloss' | 'vocab' | undefined;
}

export interface Annotated {
  parts: Part[];
  /** Glossary entries whose word could not be located in the text (still worth listing). */
  unplaced: GlossEntry[];
}

const WORD = /\p{L}+(?:-\p{L}+)*/gu;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Splits a subtitle line into parts so known words can be highlighted.
 * The line's own glossary wins (matched as whole words or phrases, case-insensitive);
 * remaining words are looked up in the learner's vocabulary through `lookup`.
 */
export function annotateLine(text: string, glossary: GlossEntry[], lookup?: (token: string) => string | undefined): Annotated {
  type Hit = { start: number; end: number; meaning: string; source: 'gloss' | 'vocab' };
  const hits: Hit[] = [];
  const unplaced: GlossEntry[] = [];

  // longest phrases first so "steht auf" wins over "steht"
  for (const g of [...glossary].sort((a, b) => b.word.length - a.word.length)) {
    const phrase = g.word.trim().split(/\s+/).map(escapeRe).join('\\s+');
    const re = new RegExp(`(?<![\\p{L}])${phrase}(?![\\p{L}])`, 'giu');
    let placed = false;
    for (const m of text.matchAll(re)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (hits.some((h) => start < h.end && end > h.start)) continue;
      hits.push({ start, end, meaning: g.meaning, source: 'gloss' });
      placed = true;
    }
    // Separable verbs and other split phrases ("steht ... früh auf"): every part must occur, in order.
    const words = g.word.trim().split(/\s+/);
    if (!placed && words.length > 1) {
      const parts: Hit[] = [];
      let from = 0;
      for (const w of words) {
        const re = new RegExp(`(?<![\\p{L}])${escapeRe(w)}(?![\\p{L}])`, 'giu');
        re.lastIndex = from;
        const m = re.exec(text);
        if (!m || hits.some((h) => m.index < h.end && m.index + m[0].length > h.start)) {
          parts.length = 0;
          break;
        }
        parts.push({ start: m.index, end: m.index + m[0].length, meaning: g.meaning, source: 'gloss' });
        from = m.index + m[0].length;
      }
      if (parts.length === words.length) {
        hits.push(...parts);
        placed = true;
      }
    }
    if (!placed) unplaced.push(g);
  }

  if (lookup) {
    for (const m of text.matchAll(WORD)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (hits.some((h) => start < h.end && end > h.start)) continue;
      const meaning = lookup(m[0]);
      if (meaning) hits.push({ start, end, meaning, source: 'vocab' });
    }
  }

  hits.sort((a, b) => a.start - b.start);
  const parts: Part[] = [];
  let pos = 0;
  for (const h of hits) {
    if (h.start > pos) parts.push({ text: text.slice(pos, h.start) });
    parts.push({ text: text.slice(h.start, h.end), meaning: h.meaning, source: h.source });
    pos = h.end;
  }
  if (pos < text.length) parts.push({ text: text.slice(pos) });
  return { parts, unplaced };
}

/** Index of the line active at `time` (the last line that started at or before it), or -1 before the first. */
export function activeIndex(segments: { start: number; end: number }[], time: number): number {
  let lo = 0;
  let hi = segments.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid]!.start <= time) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}
