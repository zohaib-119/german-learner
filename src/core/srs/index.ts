import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade } from 'ts-fsrs';
import type { Verdict } from '../grading';

export { Rating, State };
export type { Card, Grade };

const scheduler = fsrs(generatorParameters({ enable_fuzz: true }));

export const GRADES: Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

export function newCard(due: Date = new Date()): Card {
  return createEmptyCard(due);
}

export function review(card: Card, rating: Grade, now: Date = new Date()): Card {
  return scheduler.next(card, now, rating).card;
}

/** Short label for how long until the card returns: "<1m", "10m", "3h", "2d", "1mo". */
export function intervalLabel(due: Date, now: Date): string {
  const min = Math.round((due.getTime() - now.getTime()) / 60_000);
  if (min < 1) return '<1m';
  if (min < 60) return `${min}m`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d`;
  return `${Math.round(d / 30)}mo`;
}

/** What each rating would schedule next, for the buttons. */
export function previewLabels(card: Card, now: Date = new Date()): Record<Grade, string> {
  const preview = scheduler.repeat(card, now);
  const out = {} as Record<Grade, string>;
  for (const g of GRADES) out[g] = intervalLabel(preview[g].card.due, now);
  return out;
}

/** A word counts as learned once recall has graduated from the short learning steps. */
export function isLearned(card: Card): boolean {
  return card.state === State.Review || card.state === State.Relearning;
}

export function verdictToRating(v: Verdict): Grade {
  return v === 'correct' ? Rating.Good : v === 'almost' ? Rating.Hard : Rating.Again;
}
