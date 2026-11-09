import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB, deleteLesson, saveLesson } from '../src/db';
import { importLessonText } from '../src/core/importer';
import { newCard } from '../src/core/srs';

function lesson(yaml: string) {
  const r = importLessonText(yaml, 't.yaml');
  if (!r.ok) throw new Error(r.errors.join('; '));
  return r.lesson;
}

let n = 0;
let db: AppDB;
beforeEach(() => {
  db = new AppDB(`test-${n++}`);
});

describe('saveLesson', () => {
  it('stores lessons, items and exercises', async () => {
    const s = await saveLesson(
      db,
      lesson(`id: l1\ntitle: L\nitems:\n  - { de: Hund, en: dog }\nexercises:\n  - { type: translate, prompt: A, answers: [a] }\n`),
    );
    expect(s).toMatchObject({ created: true, items: 1, exercises: 1 });
    expect(await db.items.get('l1:hund')).toBeTruthy();
  });

  it('re-import keeps cards for unchanged items and drops cards for removed ones', async () => {
    await saveLesson(db, lesson(`id: l1\ntitle: L\nitems:\n  - { de: Hund, en: dog }\n  - { de: Katze, en: cat }\n`));
    await db.cards.bulkPut([
      { id: 'l1:hund#de_en', itemUid: 'l1:hund', lessonId: 'l1', mode: 'de_en', due: 0, fsrs: newCard(), lapses: 0 },
      { id: 'l1:katze#de_en', itemUid: 'l1:katze', lessonId: 'l1', mode: 'de_en', due: 0, fsrs: newCard(), lapses: 0 },
    ]);
    const s = await saveLesson(db, lesson(`id: l1\ntitle: L2\nitems:\n  - { de: Hund, en: dog (edited) }\n`));
    expect(s).toMatchObject({ created: false, removedItems: 1 });
    expect(await db.cards.get('l1:hund#de_en')).toBeTruthy();
    expect(await db.cards.get('l1:katze#de_en')).toBeUndefined();
    expect((await db.items.get('l1:hund'))?.en).toBe('dog (edited)');
  });

  it('re-import drops the example card of an item whose example was removed', async () => {
    await saveLesson(db, lesson(`id: l1\ntitle: L\nitems:\n  - { de: Hund, en: dog, example: { de: Der Hund bellt., en: The dog barks. } }\n`));
    await db.cards.bulkPut([
      { id: 'l1:hund#de_en', itemUid: 'l1:hund', lessonId: 'l1', mode: 'de_en', due: 0, fsrs: newCard(), lapses: 0 },
      { id: 'l1:hund#ex_listen', itemUid: 'l1:hund', lessonId: 'l1', mode: 'ex_listen', due: 0, fsrs: newCard(), lapses: 0 },
    ]);
    await saveLesson(db, lesson(`id: l1\ntitle: L\nitems:\n  - { de: Hund, en: dog }\n`));
    expect(await db.cards.get('l1:hund#de_en')).toBeTruthy();
    expect(await db.cards.get('l1:hund#ex_listen')).toBeUndefined();
  });

  it('preserves the enabled flag on re-import and deleteLesson cleans up', async () => {
    await saveLesson(db, lesson(`id: l1\ntitle: L\nitems:\n  - { de: Hund, en: dog }\n`));
    await db.lessons.update('l1', { enabled: false });
    await saveLesson(db, lesson(`id: l1\ntitle: L\nitems:\n  - { de: Hund, en: dog }\n`));
    expect((await db.lessons.get('l1'))?.enabled).toBe(false);
    await deleteLesson(db, 'l1');
    expect(await db.items.count()).toBe(0);
    expect(await db.lessons.count()).toBe(0);
  });
});
