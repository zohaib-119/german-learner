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
  for (let i = 0; i < 3 && card.fsrs.state !== State.Review; i++) {
    card = (await applyCardReview(db, card, Rating.Good, 1000, now)).card;
    now = new Date(card.due);
  }
  return { card };
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

  it('learning a word creates only reading + listening cards, never spelling cards', async () => {
    const { card } = await learn('l1:brot');
    expect(card.fsrs.state).toBe(State.Review);
    expect((await db.cards.toArray()).map((c) => c.mode).sort()).toEqual(['de_en', 'listen_en']);
  });
});

describe('practice modes', () => {
  const later = new Date(t0.getTime() + 3 * 24 * 3600_000);

  it('reading and listening drills only contain their own card type', async () => {
    await learn('l1:brot');
    const reading = await buildSession(db, { stage: 'reading', lessonId: 'l1', newLimit: 8, now: later });
    expect(reading.entries.map((e) => e.key)).toEqual(['l1:brot#de_en']);
    const listening = await buildSession(db, { stage: 'listening', lessonId: 'l1', newLimit: 8, now: later });
    expect(listening.entries.map((e) => e.key)).toEqual(['l1:brot#listen_en']);
    // drills never introduce new words
    expect((await buildSession(db, { stage: 'reading', lessonId: 'l1', newLimit: 8, now: later })).entries.some((e) => e.type === 'intro')).toBe(false);
  });

  it('drills can practise ahead when nothing is due yet', async () => {
    await learn('l1:brot');
    const plan = await buildSession(db, { stage: 'reading', lessonId: 'l1', newLimit: 8, now: t0 });
    expect(plan.entries.map((e) => e.key)).toEqual(['l1:brot#de_en']);
  });

  it('spelling is built on demand from learned words only', async () => {
    const empty = await buildSession(db, { stage: 'spelling', lessonId: 'l1', newLimit: 8, now: t0 });
    expect(empty.entries).toHaveLength(0); // nothing learned yet
    await introduceItem(db, (await db.items.get('l1:kaese'))!, t0); // introduced but not learned
    expect((await buildSession(db, { stage: 'spelling', lessonId: 'l1', newLimit: 8, now: t0 })).entries).toHaveLength(0);

    await learn('l1:brot');
    const plan = await buildSession(db, { stage: 'spelling', lessonId: 'l1', newLimit: 8, now: later });
    expect(plan.entries.map((e) => e.key).sort()).toEqual(['l1:brot#en_de', 'l1:brot#listen_type']);
  });

  it('spelling cards stay out of the words stage, review and due counts', async () => {
    await learn('l1:brot');
    await buildSession(db, { stage: 'spelling', lessonId: 'l1', newLimit: 8, now: later }); // creates the cards, due now
    const progress = (await getLessonProgress(db, 'l1', later.getTime()))!;
    expect(progress.due.spelling).toBe(2);
    expect(progress.due.words).toBe(progress.due.reading + progress.due.listening);
    const review = await buildSession(db, { stage: 'review', newLimit: 0, now: later });
    expect(review.entries.every((e) => e.type !== 'card' || (e.mode !== 'en_de' && e.mode !== 'listen_type'))).toBe(true);
    const words = await buildSession(db, { stage: 'words', lessonId: 'l1', newLimit: 0, now: later });
    expect(words.entries.every((e) => e.type !== 'card' || (e.mode !== 'en_de' && e.mode !== 'listen_type'))).toBe(true);
    expect((await getOverview(db, later.getTime())).dueTotal).toBe(progress.due.words + progress.due.sentences);
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

describe('sentence stage slots', () => {
  it('shares new slots between example sentences and exercises', async () => {
    const many = new AppDB(`many-${n++}`);
    const items = Array.from({ length: 5 }, (_, i) => `  - { kind: noun, de: Wort${i}, en: w${i}, example: { de: "Satz ${i}.", en: s${i} } }`).join('\n');
    const exs = Array.from({ length: 4 }, (_, i) => `  - { type: translate, prompt: p${i}, answers: [a${i}] }`).join('\n');
    const r = importLessonText(`id: m\ntitle: M\nitems:\n${items}\nexercises:\n${exs}\n`, 'm.yaml');
    if (!r.ok) throw new Error(r.errors.join());
    await saveLesson(many, r.lesson);
    await unlockSentences(many, 'm');
    const plan = await buildSession(many, { stage: 'sentences', lessonId: 'm', newLimit: 4, now: t0 });
    expect(plan.entries.filter((e) => e.type === 'card')).toHaveLength(2);
    expect(plan.entries.filter((e) => e.type === 'exercise')).toHaveLength(2);
    // when one kind runs out, the other uses the spare slots
    const few = await buildSession(many, { stage: 'sentences', lessonId: 'm', newLimit: 20, now: t0 });
    expect(few.entries).toHaveLength(9);
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
