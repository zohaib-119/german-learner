import { LineCounter, parseDocument, isNode } from 'yaml';
import { ExerciseSchema, ItemSchema, LessonSchema, SCHEMA_VERSION } from '../schema';
import type { ExerciseInput, ItemInput } from '../schema';
import { buildLexicon, exerciseGermanTexts, uncoveredWords } from '../vocab';
import { parseCsv } from './csv';

export type NormalizedItem = Omit<ItemInput, 'id'> & { id: string };
export type NormalizedExercise = ExerciseInput & { id: string };

export interface NormalizedLesson {
  schema_version: number;
  id: string;
  title: string;
  tags: string[];
  source?: string | undefined;
  items: NormalizedItem[];
  exercises: NormalizedExercise[];
}

export type ImportResult =
  | { ok: true; lesson: NormalizedLesson; warnings: string[] }
  | { ok: false; errors: string[] };

/** "Käse & Brot" -> "kaese-brot". Stable id derived from German text. */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Small stable (FNV-1a) hash so exercise ids survive reordering. */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function exerciseKey(e: ExerciseInput): string {
  switch (e.type) {
    case 'fill_blank':
      return e.prompt + '|' + e.answer;
    case 'word_order':
      return e.tokens.join(' ') + '|' + e.answers[0];
    case 'translate':
      return e.prompt + '|' + e.answers[0];
    case 'multiple_choice':
      return e.prompt + '|' + e.options.join('/');
  }
}

/** Entry point: decides format by file extension and returns a validated lesson or located errors. */
export function importLessonText(text: string, fileName: string): ImportResult {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.csv')) return importCsv(text, fileName);
  if (lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.json')) {
    return importYaml(text);
  }
  return { ok: false, errors: [`Unsupported file type: ${fileName} (use .yaml, .yml, .json or .csv)`] };
}

function importYaml(text: string): ImportResult {
  const lc = new LineCounter();
  const doc = parseDocument(text, { lineCounter: lc });
  if (doc.errors.length > 0) {
    return { ok: false, errors: doc.errors.map((e) => `YAML syntax: ${e.message.split('\n')[0]}`) };
  }
  const data = doc.toJS();
  const parsed = LessonSchema.safeParse(data);
  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue) => {
      const path = issue.path.filter((p): p is string | number => typeof p !== 'symbol');
      const line = lineOf(doc, lc, path);
      return `${formatPath(path)}: ${issue.message}${line ? ` (line ${line})` : ''}`;
    });
    return { ok: false, errors };
  }
  return finalize(parsed.data);
}

function lineOf(doc: ReturnType<typeof parseDocument>, lc: LineCounter, path: (string | number)[]): number | null {
  const p = [...path];
  while (true) {
    const node = doc.getIn(p, true);
    if (isNode(node) && node.range) return lc.linePos(node.range[0]).line;
    if (p.length === 0) return null;
    p.pop();
  }
}

function formatPath(path: (string | number)[]): string {
  if (path.length === 0) return '(file)';
  return path.map((p, i) => (typeof p === 'number' ? `[${p}]` : i === 0 ? p : `.${p}`)).join('');
}

/**
 * CSV = vocab-only lesson. Header columns (any order, case-insensitive):
 * de, en, article, plural, kind, example_de, example_en, tts, notes
 * Lesson id/title come from the file name.
 */
function importCsv(text: string, fileName: string): ImportResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, errors: ['CSV needs a header row and at least one data row'] };
  const header = rows[0]!.map((h) => h.trim().toLowerCase());
  for (const required of ['de', 'en']) {
    if (!header.includes(required)) return { ok: false, errors: [`CSV header is missing required column "${required}"`] };
  }
  const base = fileName.replace(/\.[^.]+$/, '');
  const items: unknown[] = [];
  const errors: string[] = [];
  rows.slice(1).forEach((row, idx) => {
    if (row.every((c) => c.trim() === '')) return;
    const rec: Record<string, string> = {};
    header.forEach((h, i) => {
      const v = (row[i] ?? '').trim();
      if (v) rec[h] = v;
    });
    const candidate = {
      kind: rec.kind,
      de: rec.de,
      en: rec.en,
      article: rec.article,
      plural: rec.plural,
      tts: rec.tts,
      notes: rec.notes,
      example: rec.example_de ? { de: rec.example_de, en: rec.example_en } : undefined,
    };
    const r = ItemSchema.safeParse(candidate);
    if (!r.success) {
      for (const issue of r.error.issues) errors.push(`row ${idx + 2}, ${issue.path.join('.') || 'row'}: ${issue.message}`);
    } else items.push(r.data);
  });
  if (errors.length) return { ok: false, errors };
  const parsed = LessonSchema.safeParse({ id: slugify(base) || 'lesson', title: base, items });
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => i.message) };
  return finalize(parsed.data);
}

/** Assigns stable ids, rejects duplicates, collects non-fatal warnings. */
function finalize(data: ReturnType<typeof LessonSchema.parse>): ImportResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (data.schema_version > SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`schema_version ${data.schema_version} is newer than this app supports (${SCHEMA_VERSION})`],
    };
  }

  const seenItems = new Set<string>();
  const items: NormalizedItem[] = data.items.map((it, i) => {
    const itemId = it.id ?? (slugify(it.de) || `item-${i + 1}`);
    if (seenItems.has(itemId)) errors.push(`items[${i}]: duplicate id "${itemId}" (give one of them an explicit id)`);
    seenItems.add(itemId);
    if (it.kind === 'noun' && !it.article) warnings.push(`items[${i}] "${it.de}": noun without article`);
    return { ...it, id: itemId };
  });

  const seenEx = new Set<string>();
  const exercises: NormalizedExercise[] = data.exercises.map((ex, i) => {
    const exId = ex.id ?? `${ex.type}-${hash(exerciseKey(ex))}`;
    if (seenEx.has(exId)) errors.push(`exercises[${i}]: duplicate id "${exId}"`);
    seenEx.add(exId);
    if (ex.type === 'word_order') {
      const bag = [...ex.tokens].sort().join(' ');
      ex.answers.forEach((a, j) => {
        const answerBag = a.split(/\s+/).sort().join(' ');
        if (answerBag !== bag) warnings.push(`exercises[${i}].answers[${j}]: words do not match tokens exactly`);
      });
    }
    return { ...ex, id: exId };
  });

  if (errors.length) return { ok: false, errors };

  // Sentences should only use words the learner has met as vocabulary items.
  const sentenceTexts = [
    ...items.flatMap((it) => (it.example?.de ? [it.example.de] : [])),
    ...items.filter((it) => it.kind === 'sentence').map((it) => it.de),
    ...exercises.flatMap(exerciseGermanTexts),
  ];
  const missing = uncoveredWords(sentenceTexts, buildLexicon(items));
  if (missing.length) {
    const shown = missing.slice(0, 25).join(', ') + (missing.length > 25 ? ` … (+${missing.length - 25})` : '');
    warnings.push(`Words used in sentences but missing from items (add them so they are learned first): ${shown}`);
  }

  return {
    ok: true,
    warnings,
    lesson: {
      schema_version: data.schema_version,
      id: data.id,
      title: data.title,
      tags: data.tags,
      source: data.source,
      items,
      exercises,
    },
  };
}

// Re-export so callers can validate a single exercise (used by tests/tools).
export { ExerciseSchema };
