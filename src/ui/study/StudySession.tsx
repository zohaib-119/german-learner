import { ArrowRight, CircleCheck, Lock, SkipForward, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { player } from '../../audio/player';
import { buildLexicon } from '../../core/vocab';
import { Rating, verdictToRating, type Grade } from '../../core/srs';
import { applyCardReview, applyExerciseReview, insertAt, introduceItem, requeue, type Entry, type SessionPlan } from '../../core/session';
import type { LearningSettings } from '../../core/settings';
import { db } from '../../db';
import { getLessonProgress, type CardMode } from '../../db/progress';
import { ExerciseView, type ExerciseContext } from '../../exercises';
import { AudioBanner, ProgressBar } from '../components';
import { href, navigate, useAsync } from '../hooks';
import { FlipView, IntroView, TypeView, type FlipMode } from './views';

const STAGE_TITLE = { words: 'Words', reading: 'Reading', listening: 'Listening', spelling: 'Spelling', sentences: 'Sentences', review: 'Review' } as const;

export function StudySession({ plan, learning, exitTo }: { plan: SessionPlan; learning: LearningSettings; exitTo: string }) {
  const [queue, setQueue] = useState<Entry[]>(plan.entries);
  const [turn, setTurn] = useState(0);
  const [done, setDone] = useState(0);
  const [tally, setTally] = useState({ answered: 0, correct: 0, introduced: 0 });
  const busy = useRef(false);
  const shownAt = useRef(Date.now());

  const lexicon = useMemo(() => buildLexicon(plan.items), [plan.items]);
  const ctx: ExerciseContext = useMemo(
    () => ({ lexicon, strictCaps: learning.strictCaps, autoplay: learning.autoplay }),
    [lexicon, learning.strictCaps, learning.autoplay],
  );

  const current = queue[0];
  useEffect(() => {
    shownAt.current = Date.now();
    (document.activeElement as HTMLElement | null)?.blur?.();
  }, [turn]);
  useEffect(() => () => player.stop(), []);

  /** Persist an answer, then replace the head of the queue with whatever should follow. */
  async function advance(update: (rest: Entry[], now: Date) => Promise<Entry[]>, result?: { correct: boolean; introduced?: boolean }) {
    if (busy.current) return;
    busy.current = true;
    try {
      const rest = await update(queue.slice(1), new Date());
      setQueue(rest);
      setTurn((t) => t + 1);
      setDone((d) => d + 1);
      setTally((t) => ({
        answered: t.answered + (result && !result.introduced ? 1 : 0),
        correct: t.correct + (result?.correct && !result.introduced ? 1 : 0),
        introduced: t.introduced + (result?.introduced ? 1 : 0),
      }));
    } finally {
      busy.current = false;
    }
  }

  /** Drop the current card from this session only: nothing is recorded, so it simply comes back next time. */
  const onSkip = () => advance(async (rest) => rest);

  const onIntro = (entry: Extract<Entry, { type: 'intro' }>) =>
    advance(
      async (rest, now) => {
        const cards = await introduceItem(db, entry.item, now);
        const adds = cards.map((c, i) => ({
          entry: { key: c.id, type: 'card', mode: c.mode as CardMode, item: entry.item, card: c } as Entry,
          position: 3 + i * 2,
        }));
        return insertAt(rest, adds);
      },
      { correct: true, introduced: true },
    );

  const onCard = (entry: Extract<Entry, { type: 'card' }>, rating: Grade) =>
    advance(
      async (rest, now) => {
        const res = await applyCardReview(db, entry.card, rating, Date.now() - shownAt.current, now);
        return requeue(rest, { ...entry, card: res.card } as Entry, res.card.due, now.getTime());
      },
      { correct: rating >= Rating.Good },
    );

  const onExercise = (entry: Extract<Entry, { type: 'exercise' }>, verdict: 'correct' | 'almost' | 'wrong') =>
    advance(
      async (rest, now) => {
        const stat = await applyExerciseReview(db, entry.exercise, entry.stat, verdictToRating(verdict), verdict === 'correct', now);
        return requeue(rest, { ...entry, stat } as Entry, stat.due, now.getTime());
      },
      { correct: verdict === 'correct' },
    );

  if (!current) return <Summary plan={plan} tally={tally} exitTo={exitTo} />;

  const key = `${current.key}:${turn}`;
  return (
    <div className="study">
      <header className="study-top">
        <button className="icon-btn" aria-label="Close session" title="Close" onClick={() => navigate(exitTo)}>
          <X size={22} />
        </button>
        <ProgressBar value={done} max={done + queue.length} label="Session progress" />
        <span className="study-count" title="Remaining">
          {queue.length}
        </span>
        <button className="btn ghost sm" title="Skip this card for now" onClick={() => void onSkip()}>
          <SkipForward size={16} /> Skip
        </button>
      </header>
      <AudioBanner />
      <main className="study-main">
        {current.type === 'intro' && <IntroView key={key} item={current.item} ctx={ctx} onContinue={() => void onIntro(current)} />}
        {current.type === 'card' &&
          (current.mode === 'en_de' || current.mode === 'listen_type' ? (
            <TypeView
              key={key}
              item={current.item}
              mode={current.mode}
              ctx={ctx}
              onDone={(v) => void onCard(current, verdictToRating(v))}
            />
          ) : (
            <FlipView
              key={key}
              item={current.item}
              mode={current.mode as FlipMode}
              card={current.card.fsrs}
              ctx={ctx}
              onRate={(r) => void onCard(current, r)}
            />
          ))}
        {current.type === 'exercise' && (
          <ExerciseView key={key} exercise={current.exercise} ctx={ctx} onComplete={(v) => void onExercise(current, v)} />
        )}
      </main>
    </div>
  );
}

function Summary({ plan, tally, exitTo }: { plan: SessionPlan; tally: { answered: number; correct: number; introduced: number }; exitTo: string }) {
  const progress = useAsync(() => (plan.lessonId ? getLessonProgress(db, plan.lessonId) : Promise.resolve(null)), [plan.lessonId]).data;
  const accuracy = tally.answered ? Math.round((tally.correct / tally.answered) * 100) : null;
  const sentencesReady = plan.stage === 'words' && progress?.unlocked && plan.lessonId;
  return (
    <div className="study">
      <main className="study-main">
        <div className="summary">
          <div className="summary-icon">
            <CircleCheck size={56} />
          </div>
          <h1>{STAGE_TITLE[plan.stage]} complete</h1>
          <div className="tiles">
            <div className="tile-stat">
              <b>{tally.answered}</b>
              <span>Answered</span>
            </div>
            <div className="tile-stat">
              <b>{accuracy === null ? '–' : `${accuracy}%`}</b>
              <span>Correct</span>
            </div>
            <div className="tile-stat">
              <b>{tally.introduced}</b>
              <span>New</span>
            </div>
          </div>
          {plan.stage === 'words' && progress && (
            <div className="summary-progress">
              <ProgressBar value={progress.words.learned} max={progress.words.total} tone="success" label="Words learned" />
              <span className="muted">
                {progress.words.learned} / {progress.words.total} words learned
              </span>
            </div>
          )}
          <div className="action-bar row center">
            {sentencesReady && (
              <button className="btn primary lg" onClick={() => navigate(href('study/sentences', { lesson: plan.lessonId! }))}>
                Practice sentences <ArrowRight size={18} />
              </button>
            )}
            {plan.stage === 'words' && progress && !progress.unlocked && (
              <span className="muted inline">
                <Lock size={16} /> Sentences unlock at 80% learned
              </span>
            )}
            <button className={`btn lg ${sentencesReady ? '' : 'primary'}`} onClick={() => navigate(exitTo)}>
              Done
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
