import type { NormalizedExercise } from '../importer';

/** Minimal shape needed for lookups, so both lesson files and DB rows work. */
export interface LexItem {
  id: string;
  kind: string;
  de: string;
  en: string;
  article?: string | undefined;
  plural?: string | undefined;
  forms?: Record<string, string> | undefined;
  tts?: string | undefined;
}

/** Words so basic that a sentence may use them without a vocabulary entry. Tune freely. */
export const BASIC_WORDS = new Set(
  `ich du er sie es wir ihr mich dich ihn uns euch ihnen mir dir ihm mein meine meinen meinem meiner dein deine deinen
   sein seine seinen ihre ihren unser unsere euer eure der die das den dem des ein eine einen einem einer eines kein
   keine keinen keinem und oder aber denn weil dass ob wenn als wie wo was wer wann warum wieso wohin woher welche
   welcher welches nicht auch noch schon nur sehr so dann da hier dort jetzt heute ja nein doch mal immer nie oft
   bitte danke ist bin bist sind seid war waren wäre wären habe hast hat haben habt hatte hatten hätte hätten werde
   wirst wird werden wurde wurden kann kannst können könnte muss musst müssen soll sollst sollen will willst wollen
   darf darfst dürfen mag möchte möchtest möchten mit von zu zum zur bei nach aus auf in im an am für über unter vor
   um durch gegen ohne bis seit zwischen ins ans aufs beim vom man viel viele mehr wenig etwas nichts alles alle
   jeder dieser diese dieses diesen gern gerne`
    .split(/\s+/)
    .filter(Boolean),
);

/** Splits German text into words (letters incl. umlauts/ß, hyphenated compounds kept together). */
export function tokenize(text: string): string[] {
  return text.match(/\p{L}+(?:-\p{L}+)*/gu) ?? [];
}

const fold = (w: string) => w.toLowerCase().normalize('NFC');

const SEPARABLE_PREFIXES = ['ab', 'an', 'auf', 'aus', 'ein', 'mit', 'nach', 'vor', 'weg', 'zurück', 'zu', 'fest', 'her', 'hin', 'los', 'um'];

function verbForms(infinitive: string): string[] {
  const stem = infinitive.endsWith('en') ? infinitive.slice(0, -2) : infinitive.endsWith('n') ? infinitive.slice(0, -1) : infinitive;
  const endings = ['', 'e', 'st', 't', 'et', 'en', 'est', 'te', 'ten', 'test', 'tet'];
  const out = endings.map((e) => stem + e);
  out.push(`ge${stem}t`, `ge${stem}et`, infinitive);
  return out;
}

function surfaceForms(item: LexItem): string[] {
  const forms: string[] = [];
  const words = tokenize(item.de);
  forms.push(...words);
  if (item.plural) forms.push(...tokenize(item.plural));
  for (const v of Object.values(item.forms ?? {})) forms.push(...tokenize(v));

  const head = words[words.length - 1];
  if (!head) return forms;
  if (item.kind === 'noun') {
    forms.push(`${head}s`, `${head}es`, `${head}n`, `${head}en`);
  } else if (item.kind === 'verb') {
    forms.push(...verbForms(head));
    for (const p of SEPARABLE_PREFIXES) {
      if (head.startsWith(p) && head.length - p.length >= 3) forms.push(...verbForms(head.slice(p.length)));
    }
  } else if (item.kind === 'adjective') {
    forms.push(...['e', 'en', 'er', 'em', 'es', 'ere', 'ste', 'sten'].map((e) => head + e));
  }
  return forms;
}

export interface Lexicon<T extends LexItem = LexItem> {
  /** The vocabulary entry a (possibly inflected) word belongs to, if any. */
  lookup(token: string): T | undefined;
}

export function buildLexicon<T extends LexItem>(items: T[]): Lexicon<T> {
  const map = new Map<string, T>();
  // Exact headwords first so an inflected guess never shadows a real entry.
  for (const it of items) for (const w of tokenize(it.de)) if (!map.has(fold(w))) map.set(fold(w), it);
  for (const it of items) for (const f of surfaceForms(it)) if (!map.has(fold(f))) map.set(fold(f), it);
  return { lookup: (token) => map.get(fold(token)) };
}

/** Distinct words in `texts` that have no vocabulary entry and are not basic function words. */
export function uncoveredWords(texts: string[], lexicon: Lexicon): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of texts) {
    for (const w of tokenize(t)) {
      const f = fold(w);
      if (f.length <= 2 || BASIC_WORDS.has(f) || lexicon.lookup(w) || seen.has(f)) continue;
      seen.add(f);
      out.push(w);
    }
  }
  return out;
}

/** The German sentences/phrases an exercise shows or accepts (used for coverage and word hints). */
export function exerciseGermanTexts(ex: NormalizedExercise): string[] {
  switch (ex.type) {
    case 'fill_blank':
      return [ex.prompt.replace('___', ex.answer)];
    case 'word_order':
    case 'translate':
      return [ex.answers[0]!];
    case 'multiple_choice':
      return ex.options;
    case 'listen_choose':
      return [ex.audio]; // options are usually the meaning (any language), so only the audio is checked
  }
}

/** Vocabulary entries appearing in the given texts, in order of first appearance. */
export function wordsIn<T extends LexItem>(texts: string[], lexicon: Lexicon<T>): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of texts) {
    for (const w of tokenize(t)) {
      const hit = lexicon.lookup(w);
      if (hit && !seen.has(hit.id)) {
        seen.add(hit.id);
        out.push(hit);
      }
    }
  }
  return out;
}
