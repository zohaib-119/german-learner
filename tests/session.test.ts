import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AppDB, saveLesson } from '../src/db';
import { getLessonProgress, getOverview } from '../src/db/progress';
import { importLessonText } from '../src/core/importer';
import { Rating, State } from '../src/core/srs';
import { applyCardReview, applyExerciseReview, buildSession, insertAt, introduceItem, requeue, unlockSentences } from '../src/core/session';

const LESSON = `id: l1
title: L
items:
  - { kind: noun, de: Brot, article: das, en: bread, example: { de: "Ich esse Brot.", en: I eat bread. } }
  - { kind: noun, de: Käse, article: der, en: cheese }
  - { kind: verb, de: essen, en: to eat }
  - { kind: sentence, de: "Ich esse gern Käse.", en: I like eating cheese. }
exercises:
  - { type: translate, prompt: I eat bread., answers: ["Ich esse Brot."] }
  - { type: fill_blank, prompt: "Ich ___ Käse.", answer: esse }
`;

let n = 0;
let db: AppDB;
const t0 = new Date('2026-01-01T10:00:00Z');
const min = (m: number) => new Date(t0.getTime() + m * 60_000);

async function setup() {
  db = new AppDB(`session-${n++}`);
  const r = importLessonText(LESSON, 't.yaml');
  if (!r.ok) throw new Error(r.errors.join());
  await saveLesson(db, r.lesson);
}
beforeEach(setup);

/** Introduce the item and rate its recognition card Good twice so it graduates. */
async function learn(uid: string) {
  const item = (await db.items.get(uid))!;
  await introduceItem(db, item, t0);
  let card = (await db.cards.get(`${uid}#de_en`))!;
  let now = t0;
  let out;
  for (let i = 0; i < 3 && card.fsrs.state !== State.Review; i++) {
    out = await applyCardReview(db, card, item, Rating.Good, 1000, now);
    card = out.card;
    now = new Date(card.due);
  }
  return { card, spawned: out?.spawned ?? [] };
}

describe('word stage', () => {
  it('offers only word items as intros (sentences wait), capped by newLimit', async () => {
    const plan = await buildSession(db, { stage: 'words', lessonId: 'l1', newLimit: 2, now: t0 });
    expect(plan.entries.map((e) => e.key)).toEqual(['intro:l1:brot', 'intro:l1:kaese']);
    const all = await buildSession(db, { stage: 'words', lessonId: 'l1', newLimit: 10, now: t0 });
    expect(all.entries.map((e) => e.key)).toEqual(['intro:l1:brot', 'intro:l1:kaese', 'intro:l1:essen']);
  });

  it('introducing creates recognition + listening cards that are due now', async () => {
    await introduceItem(db, (await db.items.get('l1:brot'))!, t0);
    expect((await db.cards.toArray()).map((c) => c.id).sort()).toEqual(['l1:brot#de_en', 'l1:brot#listen_en']);
    const plan = await buildSession(db, { stage: 'words', lessonId: 'l1', newLimit: 1, now: t0 });
    // existing unanswered new card counts against the cap, so no further intro
    expect(plan.entries.filter((e) => e.type === 'intro')).toHaveLength(0);
    expect(plan.entries.filter((e) => e.type === 'card')).toHaveLength(2);
  });

  it('graduating recognition spawns typing cards due ~10 minutes later', async () => {
    const { card, spawned } = await learn('l1:brot');
    expect(card.fsrs.state).toBe(State.Review);
    expect(spawned.map((c) => c.mode).sort()).toEqual(['en_de', 'listen_type']);
    expect(spawned[0]!.due).toBeGreaterThan(t0.getTime());
  });
});

describe('sentence gate', () => {
  it('stays locked until 80% of words are learned, then unlocks', async () => {
    expect((await getLessonProgress(db, 'l1', t0.getTime()))!.unlocked).toBe(false);
    const locked = await buildSession(db, { stage: 'sentences', lessonId: 'l1', newLimit: 10, now: t0 });
    expect(locked.entries).toHaveLength(0);

    await learn('l1:brot');
    await learn('l1:kaese');
    expect((await getLessonProgress(db, 'l1', t0.getTime()))!.unlocked).toBe(false); // 2/3 < 80%
    await learn('l1:essen');
    const p = (await getLessonProgress(db, 'l1', t0.getTime()))!;
    expect(p.words).toMatchObject({ total: 3, learned: 3 });
    expect(p.unlocked).toBe(true);
  });

  it('can be unlocked manually', async () => {
    await unlockSentences(db, 'l1');
    expect((await getLessonProgress(db, 'l1'))!.unlocked).toBe(true);
  });

  it('sentence stage offers sentence items, example sentences and exercises', async () => {
    await unlockSentences(db, 'l1');
    const plan = await buildSession(db, { stage: 'sentences', lessonId: 'l1', newLimit: 10, now: t0 });
    const keys = plan.entries.map((e) => e.key);
    expect(keys).toContain('intro:l1:ich-esse-gern-kaese');
    expect(keys).toContain('l1:brot#ex_listen');
    expect(plan.entries.filter((e) => e.type === 'exercise')).toHaveLength(2);
    // word items never appear as intros in the sentence stage
    expect(keys).not.toContain('intro:l1:brot');
  });

  it('re-import keeps a manual unlock', async () => {
    await unlockSentences(db, 'l1');
    const r = importLessonText(LESSON, 't.yaml');
    if (r.ok) await saveLesson(db, r.lesson);
    expect((await db.lessons.get('l1'))!.sentencesUnlocked).toBe(true);
  });
});

describe('exercise scheduling', () => {
  it('failed exercises come back soon, passed ones later', async () => {
    await unlockSentences(db, 'l1');
    const [a, b] = await db.exercises.toArray();
    const sa = await applyExerciseReview(db, a!, null, Rating.Again, false, t0);
    const sb = await applyExerciseReview(db, b!, null, Rating.Good, true, t0);
    expect(sa.due - t0.getTime()).toBeLessThanOrEqual(2 * 60_000);
    expect(sb.due - t0.getTime()).toBeGreaterThanOrEqual(5 * 60_000);
    const later = await buildSession(db, { stage: 'review', newLimit: 0, now: min(3) });
    expect(later.entries.map((e) => e.key)).toEqual([a!.uid]);
  });
});

describe('overview + review', () => {
  it('review contains due cards from enabled lessons only', async () => {
    await introduceItem(db, (await db.items.get('l1:brot'))!, t0);
    expect((await getOverview(db, t0.getTime())).dueTotal).toBe(2);
    const review = await buildSession(db, { stage: 'review', newLimit: 0, now: t0 });
    expect(review.entries).toHaveLength(2);
    await db.lessons.update('l1', { enabled: false });
    expect((await buildSession(db, { stage: 'review', newLimit: 0, now: t0 })).entries).toHaveLength(0);
  });
});

describe('queue helpers', () => {
  it('insertAt clamps positions and keeps order', () => {
    expect(insertAt(['a', 'b'], [{ entry: 'x', position: 1 }, { entry: 'y', position: 9 }])).toEqual(['a', 'x', 'b', 'y']);
  });
  it('requeue only when due within the session horizon', () => {
    const q = ['a', 'b', 'c', 'd', 'e', 'f'];
    expect(requeue(q, 'x', t0.getTime() + 60_000, t0.getTime())).toEqual(['a', 'b', 'c', 'd', 'x', 'e', 'f']);
    expect(requeue(q, 'x', t0.getTime() + 24 * 3600_000, t0.getTime())).toEqual(q);
  });
});
