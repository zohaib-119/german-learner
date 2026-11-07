import type { AppDB, CardRow, ExerciseRow, ExerciseStatRow, ItemRow } from '../../db';
import { RECOGNITION_MODES, SPELLING_MODES, UNLOCK_RATIO, cardId, getLessonProgress, isWordItem, type CardMode } from '../../db/progress';
import { isLearned, newCard, review, State, type Grade } from '../srs';

/**
 * words      – new words + reading and listening recognition (the main path)
 * reading    – drill: see the German word, recall the meaning
 * listening  – drill: hear the word, recall the meaning
 * spelling   – optional drill: type words you have already learned
 * sentences  – example sentences, sentence items and exercises (after the word threshold)
 * review     – everything due across lessons, except spelling
 */
export type Stage = 'words' | 'reading' | 'listening' | 'spelling' | 'sentences' | 'review';

/** Which cards of *word* items each stage may show. */
const WORD_CARD_MODES: Record<Stage, CardMode[]> = {
  words: RECOGNITION_MODES,
  reading: ['de_en'],
  listening: ['listen_en'],
  spelling: SPELLING_MODES,
  sentences: [],
  review: RECOGNITION_MODES,
};
const DRILLS: Stage[] = ['reading', 'listening', 'spelling'];
/** A drill session fills up to this many cards, using not-yet-due cards if needed. */
export const DRILL_SIZE = 12;

/** How far ahead (minutes) a card may come due and still be shown again within the same session. */
export const HORIZON_MIN = 15;
export type Entry =
  | { key: string; type: 'intro'; item: ItemRow }
  | { key: string; type: 'card'; mode: CardMode; item: ItemRow; card: CardRow }
  | { key: string; type: 'exercise'; exercise: ExerciseRow; stat: ExerciseStatRow | null };

export interface SessionPlan {
  stage: Stage;
  lessonId?: string | undefined;
  entries: Entry[];
  /** All items of the lessons involved, used to look up word meanings while studying. */
  items: ItemRow[];
}

export interface BuildOptions {
  stage: Stage;
  lessonId?: string;
  newLimit: number;
  now?: Date;
}

function shuffle<T>(a: T[]): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function makeCard(item: ItemRow, mode: CardMode, due: Date): CardRow {
  const fsrs = newCard(due);
  return { id: cardId(item.uid, mode), itemUid: item.uid, lessonId: item.lessonId, mode, due: due.getTime(), fsrs, lapses: 0 };
}

export async function buildSession(database: AppDB, opts: BuildOptions): Promise<SessionPlan> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const lessonIds = opts.lessonId
    ? [opts.lessonId]
    : ((await database.lessons.filter((l) => l.enabled).primaryKeys()) as string[]);

  const entries: Entry[] = [];
  const allItems: ItemRow[] = [];

  for (const lid of lessonIds) {
    const [rawItems, cards, rawExercises, stats] = await Promise.all([
      database.items.where('lessonId').equals(lid).toArray(),
      database.cards.where('lessonId').equals(lid).toArray(),
      database.exercises.where('lessonId').equals(lid).toArray(),
      database.exerciseStats.where('lessonId').equals(lid).toArray(),
    ]);
    const items = rawItems.sort((a, b) => a.order - b.order);
    const exercises = rawExercises.sort((a, b) => a.order - b.order);
    allItems.push(...items);
    const itemByUid = new Map(items.map((i) => [i.uid, i]));
    const cardById = new Map(cards.map((c) => [c.id, c]));
    const statById = new Map(stats.map((s) => [s.id, s]));

    if (opts.stage === 'sentences') {
      const progress = await getLessonProgress(database, lid, nowMs);
      if (!progress?.unlocked) continue;
    }

    const wantsSentences = opts.stage === 'sentences' || opts.stage === 'review';
    const wordModes = WORD_CARD_MODES[opts.stage];
    const lessonStart = entries.length;
    const wanted = (c: CardRow): boolean => {
      const it = itemByUid.get(c.itemUid);
      if (!it) return false;
      const mode = c.mode as CardMode;
      if (SPELLING_MODES.includes(mode)) return isWordItem(it) && wordModes.includes(mode); // spelling only in its own drill
      if (isWordItem(it) && mode !== 'ex_listen') return wordModes.includes(mode);
      return wantsSentences;
    };

    // 1. Everything that is due.
    const dueCards = cards.filter((c) => c.due <= nowMs && wanted(c)).sort((a, b) => a.due - b.due);
    for (const c of dueCards) {
      entries.push({ key: c.id, type: 'card', mode: c.mode as CardMode, item: itemByUid.get(c.itemUid)!, card: c });
    }
    if (wantsSentences) {
      for (const ex of exercises) {
        const st = statById.get(ex.uid);
        if (st && st.due <= nowMs) entries.push({ key: ex.uid, type: 'exercise', exercise: ex, stat: st });
      }
    }

    // Drills: top up with spelling cards for learned words, then with the soonest not-yet-due cards.
    if (DRILLS.includes(opts.stage)) {
      const count = () => entries.length - lessonStart;
      if (opts.stage === 'spelling') {
        for (const it of items.filter(isWordItem)) {
          const recognised = cardById.get(cardId(it.uid, 'de_en'));
          if (!recognised || !isLearned(recognised.fsrs)) continue;
          for (const mode of SPELLING_MODES) {
            if (count() >= DRILL_SIZE) break;
            if (cardById.has(cardId(it.uid, mode))) continue;
            const card = makeCard(it, mode, now);
            await database.cards.put(card);
            cardById.set(card.id, card);
            entries.push({ key: card.id, type: 'card', mode, item: it, card });
          }
        }
      }
      const queued = new Set(entries.map((e) => e.key));
      const upcoming = cards.filter((c) => c.due > nowMs && wanted(c) && !queued.has(c.id)).sort((a, b) => a.due - b.due);
      for (const c of upcoming) {
        if (count() >= DRILL_SIZE) break;
        entries.push({ key: c.id, type: 'card', mode: c.mode as CardMode, item: itemByUid.get(c.itemUid)!, card: c });
      }
      continue;
    }

    // 2. New material, capped per session. Cards created but never answered count against the cap.
    if (opts.stage === 'review') continue;
    const pendingNew = cards.filter((c) => c.due <= nowMs && c.fsrs.state === State.New && (c.mode === 'de_en' || c.mode === 'ex_listen')).length;
    let slots = Math.max(0, opts.newLimit - pendingNew);

    if (opts.stage === 'words') {
      for (const it of items.filter(isWordItem)) {
        if (slots <= 0) break;
        if (!cardById.has(cardId(it.uid, 'de_en'))) {
          entries.push({ key: `intro:${it.uid}`, type: 'intro', item: it });
          slots--;
        }
      }
    } else {
      for (const it of items.filter((i) => !isWordItem(i))) {
        if (slots <= 0) break;
        if (!cardById.has(cardId(it.uid, 'de_en'))) {
          entries.push({ key: `intro:${it.uid}`, type: 'intro', item: it });
          slots--;
        }
      }
      // Share the remaining slots between example sentences and exercises, so exercises are never
      // starved behind a long list of examples; unused slots go to whichever has more left.
      const newExamples = items.filter((i) => isWordItem(i) && i.example?.de && !cardById.has(cardId(i.uid, 'ex_listen')));
      const newExercises = exercises.filter((ex) => !statById.has(ex.uid));
      let nExamples = Math.min(newExamples.length, Math.ceil(slots / 2));
      const nExercises = Math.min(newExercises.length, slots - nExamples);
      nExamples = Math.min(newExamples.length, slots - nExercises);
      for (const it of newExamples.slice(0, nExamples)) {
        const card = makeCard(it, 'ex_listen', now);
        await database.cards.put(card);
        entries.push({ key: card.id, type: 'card', mode: 'ex_listen', item: it, card });
      }
      for (const ex of newExercises.slice(0, nExercises)) {
        entries.push({ key: ex.uid, type: 'exercise', exercise: ex, stat: null });
      }
    }
  }

  return {
    stage: opts.stage,
    lessonId: opts.lessonId,
    entries: opts.stage === 'review' || DRILLS.includes(opts.stage) ? shuffle(entries) : entries,
    items: allItems,
  };
}

/** Called when the learner has seen a new word: creates its first recall cards. */
export async function introduceItem(database: AppDB, item: ItemRow, now = new Date()): Promise<CardRow[]> {
  const cards = (['de_en', 'listen_en'] as CardMode[]).map((m) => makeCard(item, m, now));
  await database.transaction('rw', database.cards, async () => {
    for (const c of cards) if (!(await database.cards.get(c.id))) await database.cards.put(c);
  });
  return (await database.cards.bulkGet(cards.map((c) => c.id))).filter((c): c is CardRow => !!c);
}

export interface CardReviewResult {
  card: CardRow;
}

export async function applyCardReview(
  database: AppDB,
  card: CardRow,
  rating: Grade,
  ms: number,
  now = new Date(),
): Promise<CardReviewResult> {
  const next = review(card.fsrs, rating, now);
  const updated: CardRow = { ...card, fsrs: next, due: next.due.getTime(), lapses: next.lapses };
  await database.transaction('rw', database.cards, database.reviews, async () => {
    await database.cards.put(updated);
    await database.reviews.add({ cardId: card.id, ts: now.getTime(), rating, ms, mode: card.mode });
  });
  return { card: updated };
}

export async function applyExerciseReview(
  database: AppDB,
  exercise: ExerciseRow,
  stat: ExerciseStatRow | null,
  rating: Grade,
  correct: boolean,
  now = new Date(),
): Promise<ExerciseStatRow> {
  const next = review(stat?.fsrs ?? newCard(now), rating, now);
  const updated: ExerciseStatRow = { id: exercise.uid, lessonId: exercise.lessonId, due: next.due.getTime(), fsrs: next, lastResult: correct };
  await database.exerciseStats.put(updated);
  return updated;
}

/** Marks a lesson's sentences as available regardless of word progress. */
export async function unlockSentences(database: AppDB, lessonId: string): Promise<void> {
  await database.lessons.update(lessonId, { sentencesUnlocked: true });
}

// ---- queue helpers (pure, used by the study screen) --------------------------------------------

/** Insert entries at the given positions (clamped to the queue length), in order. */
export function insertAt<T>(queue: T[], additions: { entry: T; position: number }[]): T[] {
  const out = [...queue];
  for (const { entry, position } of [...additions].sort((a, b) => a.position - b.position)) {
    out.splice(Math.min(position, out.length), 0, entry);
  }
  return out;
}

/** After answering: if the card returns within the session horizon, show it again soon. */
export function requeue<T>(queue: T[], entry: T, dueMs: number, nowMs: number, gap = 4): T[] {
  if (dueMs - nowMs > HORIZON_MIN * 60_000) return queue;
  return insertAt(queue, [{ entry, position: gap }]);
}

export { UNLOCK_RATIO };
