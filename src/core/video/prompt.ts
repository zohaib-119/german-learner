import type { Line } from './lines';

export interface PromptOptions {
  /** Learner level, e.g. "A0" (complete beginner) or "A2". */
  level: string;
  /** Name of the video language, e.g. "German". */
  sourceLanguage: string;
  /** Name of the translation language, e.g. "English". */
  targetLanguage: string;
  /**
   * "all": explain every word of every line, every time it appears (complete beginners).
   * "hard": only words a learner at `level` probably doesn't know.
   */
  glossMode?: 'all' | 'hard' | undefined;
  title?: string | undefined;
}

export const DEFAULT_PROMPT_OPTIONS: PromptOptions = { level: 'A0', sourceLanguage: 'German', targetLanguage: 'English', glossMode: 'all' };

export interface Chunk {
  /** 0-based chunk number. */
  index: number;
  /** Lines in this chunk with their 1-based global line numbers. */
  lines: { i: number; text: string }[];
}

/** Splits lines into groups small enough for one AI reply. Line numbers are global and 1-based. */
export function chunkLines(lines: Line[], { maxLines = 15, maxChars = 1800 } = {}): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Chunk | null = null;
  let chars = 0;
  lines.forEach((l, idx) => {
    const item = { i: idx + 1, text: l.text };
    if (cur && (cur.lines.length >= maxLines || chars + l.text.length > maxChars)) {
      chunks.push(cur);
      cur = null;
    }
    if (!cur) {
      cur = { index: chunks.length, lines: [] };
      chars = 0;
    }
    cur.lines.push(item);
    chars += l.text.length + 8;
  });
  if (cur) chunks.push(cur);
  return chunks;
}

const levelName = (level: string) => (/^A0/i.test(level) ? 'complete beginner (knows no words yet)' : `${level}`);

function rules(o: PromptOptions): string {
  const all = (o.glossMode ?? 'all') === 'all';
  const words = all
    ? `- "g": EVERY word of the line, in the order they appear, including small words (articles, pronouns, prepositions, particles). If a word appears again in this or a later line, explain it again there; never refer back to an earlier line. Skip only numbers and names.`
    : `- "g": only the words a ${o.level} learner of ${o.sourceLanguage} is likely NOT to know; skip very common words. At most 6 per line; [] if none.`;
  return `Reply with ONE JSON array inside a single json code block and nothing else. Return exactly one object per numbered line, in the same order:
{"i": <line number>, "t": "<natural ${o.targetLanguage} translation of the whole line>", "g": [{"w": "<word exactly as written in the line>", "b": "<dictionary form>", "k": "<word type>", "m": "<${o.targetLanguage} meaning in this line>"}], "p": [{"p": "<phrase exactly as written in the line>", "m": "<${o.targetLanguage} meaning of the whole phrase>", "n": "<why: literal meaning or how it is built>"}]}

Rules:
- "i" is the line number given below. Never skip, merge, split or renumber lines.
- "t": a faithful, natural translation of the full line. If the speech-recognition text has an obvious mistake, translate what was meant. No commentary.
${words}
- "w" must be copied exactly from the line (same spelling and word form) so it can be highlighted. For a separable verb whose parts are split in the line, write both parts in order separated by a space (e.g. "steht auf" for "steht ... früh auf") and give it one entry.
- "b": the dictionary form: nouns with their article ("der Bäcker"), verbs in the infinitive ("aufstehen"), adjectives without endings ("früh").
- "k": one of noun, verb, adjective, adverb, pronoun, article, preposition, conjunction, particle, number, other.
- "m": the meaning in THIS line, short (e.g. "gets up", "the baker"). For verbs add the person/tense when it helps (e.g. "(I) buy").
- "p": every fixed expression, idiom or word group whose meaning is more than its words (e.g. "Wie geht's?", "auf jeden Fall", "Lust haben", "es gibt"). Explain the whole phrase in "m" and why it means that in "n" (literal translation or how it is built). Use [] when there is none. Words in a phrase still get their own "g" entries.
- Output valid JSON only: double quotes, escape any quote inside a string, no trailing commas, no comments.`;
}

/** The full message to send to the AI for one chunk. */
export function buildPrompt(chunk: Chunk, total: number, options: PromptOptions): string {
  const o = options;
  const title = o.title ? ` titled "${o.title}"` : '';
  const what = (o.glossMode ?? 'all') === 'all' ? 'the meaning of every word, and every phrase explained' : 'the meanings of the words the learner may not know, and every phrase explained';
  const head = `You are helping a ${levelName(o.level)} learner of ${o.sourceLanguage} study a video${title}. Below are numbered ${o.sourceLanguage} subtitle lines (part ${chunk.index + 1} of ${total}). For EVERY line give its ${o.targetLanguage} translation, ${what}.`;
  const body = chunk.lines.map((l) => `${l.i} | ${l.text}`).join('\n');
  return `${head}\n\n${rules(o)}\n\nLines:\n${body}`;
}

/** Message asking the AI to redo only the lines it missed or got wrong. */
export function buildRetryPrompt(missing: number[], chunk: Chunk, options: PromptOptions): string {
  const wanted = new Set(missing);
  const body = chunk.lines.filter((l) => wanted.has(l.i)).map((l) => `${l.i} | ${l.text}`).join('\n');
  return `Your last reply was missing or had invalid entries for some lines. Reply again with ONE json code block containing only objects for these line numbers, in the same format as before (valid JSON only).\n\n${rules(options)}\n\nLines:\n${body}`;
}

// ---- reply parsing -----------------------------------------------------------------------------

export interface AiGloss {
  w: string;
  m: string;
  b?: string | undefined;
  k?: string | undefined;
}
export interface AiPhrase {
  p: string;
  m: string;
  n?: string | undefined;
}
export interface AiItem {
  i: number;
  t: string;
  g: AiGloss[];
  p: AiPhrase[];
}

/** Finds balanced `[...]` or `{...}` JSON snippets in free text, respecting strings. */
function jsonSnippets(text: string): string[] {
  const out: string[] = [];
  for (let start = 0; start < text.length; start++) {
    const open = text[start];
    if (open !== '[' && open !== '{') continue;
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    let inStr = false;
    for (let j = start; j < text.length; j++) {
      const c = text[j]!;
      if (inStr) {
        if (c === '\\') j++;
        else if (c === '"') inStr = false;
      } else if (c === '"') inStr = true;
      else if (c === open) depth++;
      else if (c === close && --depth === 0) {
        out.push(text.slice(start, j + 1));
        start = j;
        break;
      }
    }
  }
  return out;
}

function asString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

function toItem(o: unknown): AiItem | null {
  if (!o || typeof o !== 'object') return null;
  const r = o as Record<string, unknown>;
  const rawI = r.i ?? r.index ?? r.line ?? r.n ?? r.id;
  const i = typeof rawI === 'number' ? rawI : typeof rawI === 'string' ? Number(rawI.trim()) : NaN;
  const t = asString(r.t ?? r.translation ?? r.en);
  if (!Number.isInteger(i) || i < 1 || !t) return null;
  const rawG = r.g ?? r.glossary ?? r.words;
  const g: AiGloss[] = [];
  if (Array.isArray(rawG)) {
    for (const e of rawG) {
      if (!e || typeof e !== 'object') continue;
      const x = e as Record<string, unknown>;
      const w = asString(x.w ?? x.word);
      const m = asString(x.m ?? x.meaning ?? x.def);
      const b = asString(x.b ?? x.base ?? x.lemma);
      const k = asString(x.k ?? x.kind ?? x.type);
      if (w && m) g.push({ w, m, ...(b ? { b } : {}), ...(k ? { k } : {}) });
    }
  }
  const rawP = r.p ?? r.phrases;
  const p: AiPhrase[] = [];
  if (Array.isArray(rawP)) {
    for (const e of rawP) {
      if (!e || typeof e !== 'object') continue;
      const x = e as Record<string, unknown>;
      const text = asString(x.p ?? x.phrase ?? x.text);
      const m = asString(x.m ?? x.meaning);
      const n = asString(x.n ?? x.note ?? x.literal);
      if (text && m) p.push({ p: text, m, ...(n ? { n } : {}) });
    }
  }
  return { i, t, g, p };
}

/** Extracts the per-line results from an AI reply, tolerating code fences, prose and small shape differences. */
export function parseAiReply(reply: string): AiItem[] {
  const candidates = [...reply.matchAll(/```[\w-]*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  candidates.push(reply);
  const found = new Map<number, AiItem>();
  for (const c of candidates) {
    for (const snippet of jsonSnippets(c)) {
      let data: unknown;
      try {
        data = JSON.parse(snippet);
      } catch {
        continue;
      }
      const list = Array.isArray(data) ? data : data && typeof data === 'object' ? (Object.values(data).find(Array.isArray) as unknown[] | undefined) ?? [data] : [];
      for (const e of list) {
        const item = toItem(e);
        if (item) found.set(item.i, item);
      }
    }
    if (found.size) break; // prefer the first source that yields results (the code block)
  }
  return [...found.values()].sort((a, b) => a.i - b.i);
}

/** Which line numbers of `chunk` have no usable result in `items`. */
export function missingLines(chunk: Chunk, items: AiItem[]): number[] {
  const have = new Set(items.map((x) => x.i));
  return chunk.lines.filter((l) => !have.has(l.i)).map((l) => l.i);
}
