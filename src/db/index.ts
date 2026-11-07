import Dexie, { type EntityTable } from 'dexie';
import type { Card } from 'ts-fsrs';
import type { NormalizedExercise, NormalizedItem, NormalizedLesson } from '../core/importer';

export interface LessonRow {
  id: string;
  title: string;
  tags: string[];
  source?: string | undefined;
  schemaVersion: number;
  enabled: boolean;
  /** User chose to practise sentences before the word threshold was reached. */
  sentencesUnlocked?: boolean | undefined;
  importedAt: number;
}
export interface ItemRow extends NormalizedItem {
  /** Globally unique: `${lessonId}:${itemId}` */
  uid: string;
  lessonId: string;
  /** Position in the lesson file, so items are introduced in the order the author wrote them. */
  order: number;
}
export type ExerciseRow = NormalizedExercise & { uid: string; lessonId: string; order: number };

export interface CardRow {
  id: string; // `${itemUid}#${mode}`
  itemUid: string;
  lessonId: string;
  mode: string;
  /** Mirrors fsrs.due in ms so it can be indexed. */
  due: number;
  fsrs: Card;
  lapses: number;
}
export interface ExerciseStatRow {
  id: string; // exercise uid
  lessonId: string;
  due: number;
  fsrs: Card;
  lastResult?: boolean | undefined;
}
export interface ReviewRow {
  seq?: number;
  cardId: string;
  ts: number;
  rating: number;
  ms: number;
  mode: string;
}
export interface SettingRow {
  key: string;
  value: unknown;
}

export class AppDB extends Dexie {
  lessons!: EntityTable<LessonRow, 'id'>;
  items!: EntityTable<ItemRow, 'uid'>;
  exercises!: EntityTable<ExerciseRow, 'uid'>;
  cards!: EntityTable<CardRow, 'id'>;
  exerciseStats!: EntityTable<ExerciseStatRow, 'id'>;
  reviews!: EntityTable<ReviewRow, 'seq'>;
  settings!: EntityTable<SettingRow, 'key'>;

  constructor(name = 'german-learner') {
    super(name);
    this.version(1).stores({
      lessons: 'id',
      items: 'uid, lessonId',
      exercises: 'uid, lessonId',
      cards: 'id, lessonId, itemUid, due',
      exerciseStats: 'id, lessonId, due',
      reviews: '++seq, cardId, ts',
      settings: 'key',
    });
  }
}

export const db = new AppDB();

export interface SaveSummary {
  created: boolean;
  items: number;
  exercises: number;
  removedItems: number;
}

/**
 * Upsert a lesson. Items are matched by their stable id, so progress (cards) on unchanged
 * items survives re-import; cards for items that no longer exist are removed.
 */
export async function saveLesson(database: AppDB, lesson: NormalizedLesson): Promise<SaveSummary> {
  return database.transaction(
    'rw',
    [database.lessons, database.items, database.exercises, database.cards, database.exerciseStats],
    async () => {
      const existing = await database.lessons.get(lesson.id);
      await database.lessons.put({
        id: lesson.id,
        title: lesson.title,
        tags: lesson.tags,
        source: lesson.source,
        schemaVersion: lesson.schema_version,
        enabled: existing?.enabled ?? true,
        sentencesUnlocked: existing?.sentencesUnlocked,
        importedAt: Date.now(),
      });

      const itemRows: ItemRow[] = lesson.items.map((it, order) => ({ ...it, uid: `${lesson.id}:${it.id}`, lessonId: lesson.id, order }));
      const oldItemUids = (await database.items.where('lessonId').equals(lesson.id).primaryKeys()) as string[];
      const newItemUids = new Set(itemRows.map((r) => r.uid));
      const removed = oldItemUids.filter((u) => !newItemUids.has(u));
      if (removed.length) {
        await database.items.bulkDelete(removed);
        await database.cards.where('itemUid').anyOf(removed).delete();
      }
      await database.items.bulkPut(itemRows);

      const exRows: ExerciseRow[] = lesson.exercises.map((ex, order) => ({ ...ex, uid: `${lesson.id}:${ex.id}`, lessonId: lesson.id, order }));
      const oldEx = (await database.exercises.where('lessonId').equals(lesson.id).primaryKeys()) as string[];
      const newEx = new Set(exRows.map((r) => r.uid));
      const removedEx = oldEx.filter((u) => !newEx.has(u));
      if (removedEx.length) {
        await database.exercises.bulkDelete(removedEx);
        await database.exerciseStats.bulkDelete(removedEx);
      }
      await database.exercises.bulkPut(exRows);

      return { created: !existing, items: itemRows.length, exercises: exRows.length, removedItems: removed.length };
    },
  );
}

export async function deleteLesson(database: AppDB, lessonId: string): Promise<void> {
  await database.transaction(
    'rw',
    [database.lessons, database.items, database.exercises, database.cards, database.exerciseStats],
    async () => {
      await database.lessons.delete(lessonId);
      await database.items.where('lessonId').equals(lessonId).delete();
      await database.exercises.where('lessonId').equals(lessonId).delete();
      await database.cards.where('lessonId').equals(lessonId).delete();
      await database.exerciseStats.where('lessonId').equals(lessonId).delete();
    },
  );
}
