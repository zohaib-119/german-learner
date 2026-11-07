import { isLearned } from '../core/srs';
import type { AppDB, CardRow, ItemRow, LessonRow } from '.';

/** Share of a lesson's words that must be learned before its sentences unlock. */
export const UNLOCK_RATIO = 0.8;

export type CardMode = 'de_en' | 'listen_en' | 'en_de' | 'listen_type' | 'ex_listen';
/** Main path: recognise a word by reading it (de_en) and by hearing it (listen_en). */
export const RECOGNITION_MODES: CardMode[] = ['de_en', 'listen_en'];
/** Optional, separate practice: typing a word (spelling). Never part of the Words stage or Review. */
export const SPELLING_MODES: CardMode[] = ['en_de', 'listen_type'];

/** Words (nouns, verbs, phrases …) are learned first; whole sentences belong to the sentence stage. */
export const isWordItem = (it: Pick<ItemRow, 'kind'>): boolean => it.kind !== 'sentence';

export const cardId = (itemUid: string, mode: CardMode): string => `${itemUid}#${mode}`;

export interface LessonProgress {
  lesson: LessonRow;
  words: { total: number; seen: number; learned: number };
  sentences: { total: number; seen: number };
  exercises: { total: number; seen: number };
  /** `words` = reading + listening recognition cards due. Spelling is counted separately. */
  due: { words: number; reading: number; listening: number; spelling: number; sentences: number };
  unlocked: boolean;
}

export function computeProgress(
  lesson: LessonRow,
  items: ItemRow[],
  cards: CardRow[],
  exerciseCount: number,
  stats: { due: number }[],
  now: number,
): LessonProgress {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const itemByUid = new Map(items.map((i) => [i.uid, i]));
  const wordItems = items.filter(isWordItem);
  const sentenceItems = items.filter((i) => !isWordItem(i));
  const exampleItems = items.filter((i) => isWordItem(i) && i.example?.de);

  const learned = wordItems.filter((i) => {
    const c = byId.get(cardId(i.uid, 'de_en'));
    return !!c && isLearned(c.fsrs);
  }).length;

  let dueReading = 0;
  let dueListening = 0;
  let dueSpelling = 0;
  let dueSentences = 0;
  for (const c of cards) {
    if (c.due > now) continue;
    const it = itemByUid.get(c.itemUid);
    if (!it) continue;
    if (SPELLING_MODES.includes(c.mode as CardMode)) {
      if (isWordItem(it)) dueSpelling++;
    } else if (isWordItem(it) && c.mode !== 'ex_listen') {
      if (c.mode === 'de_en') dueReading++;
      else dueListening++;
    } else dueSentences++;
  }
  dueSentences += stats.filter((s) => s.due <= now).length;

  const unlocked = !!lesson.sentencesUnlocked || wordItems.length === 0 || learned / wordItems.length >= UNLOCK_RATIO;

  return {
    lesson,
    words: {
      total: wordItems.length,
      seen: wordItems.filter((i) => byId.has(cardId(i.uid, 'de_en'))).length,
      learned,
    },
    sentences: {
      total: sentenceItems.length + exampleItems.length,
      // practised = answered at least once (a card merely queued for a session does not count)
      seen:
        sentenceItems.filter((i) => (byId.get(cardId(i.uid, 'de_en'))?.fsrs.reps ?? 0) > 0).length +
        exampleItems.filter((i) => (byId.get(cardId(i.uid, 'ex_listen'))?.fsrs.reps ?? 0) > 0).length,
    },
    exercises: { total: exerciseCount, seen: stats.length },
    due: { words: dueReading + dueListening, reading: dueReading, listening: dueListening, spelling: dueSpelling, sentences: dueSentences },
    unlocked,
  };
}

export async function getLessonProgress(database: AppDB, lessonId: string, now = Date.now()): Promise<LessonProgress | null> {
  const lesson = await database.lessons.get(lessonId);
  if (!lesson) return null;
  const [items, cards, exerciseCount, stats] = await Promise.all([
    database.items.where('lessonId').equals(lessonId).toArray(),
    database.cards.where('lessonId').equals(lessonId).toArray(),
    database.exercises.where('lessonId').equals(lessonId).count(),
    database.exerciseStats.where('lessonId').equals(lessonId).toArray(),
  ]);
  return computeProgress(lesson, items, cards, exerciseCount, stats, now);
}

export interface Overview {
  lessons: LessonProgress[];
  dueTotal: number;
  learnedTotal: number;
}

export async function getOverview(database: AppDB, now = Date.now()): Promise<Overview> {
  const lessons = await database.lessons.toArray();
  const progress = (await Promise.all(lessons.map((l) => getLessonProgress(database, l.id, now)))).filter(
    (p): p is LessonProgress => !!p,
  );
  const enabled = progress.filter((p) => p.lesson.enabled);
  return {
    lessons: progress,
    dueTotal: enabled.reduce((n, p) => n + p.due.words + p.due.sentences, 0),
    learnedTotal: progress.reduce((n, p) => n + p.words.learned, 0),
  };
}
