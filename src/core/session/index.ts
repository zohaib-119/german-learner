import type { AppDB, CardRow, ExerciseRow, ExerciseStatRow, ItemRow } from '../../db';
import { UNLOCK_RATIO, WORD_MODES, cardId, getLessonProgress, isWordItem, type CardMode } from '../../db/progress';
import { State, newCard, review, type Grade } from '../srs';

export type Stage = 'words' | 'sentences' | 'review';

/** How far ahead (minutes) a card may come due and still be shown again within the same session. */
export const HORIZON_MIN = 15;
/** Production drills (typing) appear this long after the recognition card graduates. */
const PRODUCTION_DELAY_MIN = 10;

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

    const wantsWords = opts.stage !== 'sentences';
    const wantsSentences = opts.stage !== 'words';

    // 1. Everything that is due.
    const dueCards = cards
      .filter((c) => c.due <= nowMs)
      .filter((c) => {
        const it = itemByUid.get(c.itemUid);
        if (!it) return false;
        const isWordCard = isWordItem(it) && c.mode !== 'ex_listen';
        return isWordCard ? wantsWords : wantsSentences;
      })
      .sort((a, b) => a.due - b.due);
    for (const c of dueCards) {
      entries.push({ key: c.id, type: 'card', mode: c.mode as CardMode, item: itemByUid.get(c.itemUid)!, card: c });
    }
    if (wantsSentences) {
      for (const ex of exercises) {
        const st = statById.get(ex.uid);
        if (st && st.due <= nowMs) entries.push({ key: ex.uid, type: 'exercise', exercise: ex, stat: st });
      }
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
      for (const it of items.filter((i) => isWordItem(i) && i.example?.de)) {
        if (slots <= 0) break;
        if (!cardById.has(cardId(it.uid, 'ex_listen'))) {
          const card = makeCard(it, 'ex_listen', now);
          await database.cards.put(card);
          entries.push({ key: card.id, type: 'card', mode: 'ex_listen', item: it, card });
          slots--;
        }
      }
      for (const ex of exercises) {
        if (slots <= 0) break;
        if (!statById.has(ex.uid)) {
          entries.push({ key: ex.uid, type: 'exercise', exercise: ex, stat: null });
          slots--;
        }
      }
    }
  }

  return {
    stage: opts.stage,
    lessonId: opts.lessonId,
    entries: opts.stage === 'review' ? shuffle(entries) : entries,
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
  /** Production (typing) cards created because recognition just graduated. */
  spawned: CardRow[];
}

export async function applyCardReview(
  database: AppDB,
  card: CardRow,
  item: ItemRow,
  rating: Grade,
  ms: number,
  now = new Date(),
): Promise<CardReviewResult> {
  const next = review(card.fsrs, rating, now);
  const updated: CardRow = { ...card, fsrs: next, due: next.due.getTime(), lapses: next.lapses };
  const spawned: CardRow[] = [];
  await database.transaction('rw', database.cards, database.reviews, async () => {
    await database.cards.put(updated);
    await database.reviews.add({ cardId: card.id, ts: now.getTime(), rating, ms, mode: card.mode });
    if (card.mode === 'de_en' && card.fsrs.state !== State.Review && next.state === State.Review) {
      const due = new Date(now.getTime() + PRODUCTION_DELAY_MIN * 60_000);
      for (const mode of ['en_de', 'listen_type'] as CardMode[]) {
        if (!(await database.cards.get(cardId(item.uid, mode)))) {
          const c = makeCard(item, mode, due);
          await database.cards.put(c);
          spawned.push(c);
        }
      }
    }
  });
  return { card: updated, spawned };
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

export { UNLOCK_RATIO, WORD_MODES };
