export type Verdict = 'correct' | 'almost' | 'wrong';
export type Note = 'typo' | 'caps' | 'article';

export interface GradeResult {
  verdict: Verdict;
  /** The accepted answer closest to what was typed (shown as feedback). */
  expected: string;
  note?: Note;
}

export interface GradeOptions {
  /** Capital/lowercase differences count as a mistake (German noun capitalization). Default false. */
  strictCaps?: boolean;
}

/** Trim, unify quotes/dashes, drop punctuation and collapse whitespace. */
export function clean(s: string): string {
  return s
    .normalize('NFC')
    .replace(/[„“”"'’‘`´]/g, '')
    .replace(/[.,!?;:…()\[\]]/g, ' ')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ä/ae, ö/oe, ü/ue, ß/ss are treated as equal so a missing umlaut key does not fail an answer. */
function foldUmlauts(s: string): string {
  return s.replace(/ä/gi, (m) => (m === 'Ä' ? 'Ae' : 'ae')).replace(/ö/gi, (m) => (m === 'Ö' ? 'Oe' : 'oe')).replace(/ü/gi, (m) => (m === 'Ü' ? 'Ue' : 'ue')).replace(/ß/g, 'ss');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length]!;
}

/** Compare typed text against all accepted answers. */
export function gradeText(input: string, accepted: string[], opts: GradeOptions = {}): GradeResult {
  const typed = clean(input);
  const answers = accepted.map(clean);
  if (!typed || answers.length === 0) return { verdict: 'wrong', expected: accepted[0] ?? '' };

  // 1. Exact (after cleaning).
  const exact = answers.findIndex((a) => a === typed);
  if (exact >= 0) return { verdict: 'correct', expected: accepted[exact]! };

  // 2. Equal apart from umlaut spelling / capitalization.
  const t1 = foldUmlauts(typed);
  const sameCase = answers.findIndex((a) => foldUmlauts(a) === t1);
  if (sameCase >= 0) return { verdict: 'correct', expected: accepted[sameCase]! };
  const t2 = t1.toLowerCase();
  const sameLetters = answers.findIndex((a) => foldUmlauts(a).toLowerCase() === t2);
  if (sameLetters >= 0) {
    return opts.strictCaps
      ? { verdict: 'almost', expected: accepted[sameLetters]!, note: 'caps' }
      : { verdict: 'correct', expected: accepted[sameLetters]! };
  }

  // 3. Small typo -> "almost" (not for very short answers).
  let best = { i: 0, d: Infinity };
  answers.forEach((a, i) => {
    const d = levenshtein(t2, foldUmlauts(a).toLowerCase());
    if (d < best.d) best = { i, d };
  });
  const len = foldUmlauts(answers[best.i]!).length;
  const allowed = len >= 9 ? 2 : len >= 4 ? 1 : 0;
  if (best.d <= allowed) return { verdict: 'almost', expected: accepted[best.i]!, note: 'typo' };
  return { verdict: 'wrong', expected: accepted[best.i]! };
}

/** Typing the German for a vocabulary item. Nouns need their article; a bare noun is "almost". */
export function gradeVocab(input: string, item: { de: string; article?: string | undefined }, opts: GradeOptions = {}): GradeResult {
  if (!item.article) return gradeText(input, [item.de], opts);
  const withArticle = `${item.article} ${item.de}`;
  const full = gradeText(input, [withArticle], opts);
  if (full.verdict !== 'wrong') return full;
  const bare = gradeText(input, [item.de], opts);
  if (bare.verdict === 'correct') return { verdict: 'almost', expected: withArticle, note: 'article' };
  return { verdict: 'wrong', expected: withArticle };
}

/** Word ordering: the tokens are given, so only an exact sequence counts. */
export function gradeOrder(placed: string[], answers: string[]): GradeResult {
  const r = gradeText(placed.join(' '), answers, { strictCaps: true });
  return r.verdict === 'correct' ? r : { verdict: 'wrong', expected: r.expected };
}
