import { ArrowRight, BookOpen, CircleCheck, CircleX, Lightbulb, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { player } from '../audio/player';
import type { Verdict, Note } from '../core/grading';
import { wordsIn, type Lexicon, type LexItem } from '../core/vocab';
import type { ExerciseRow } from '../db';
import { SpeakButton, Word } from '../ui/components';
import { useKeys } from '../ui/hooks';

export type Ex<T extends ExerciseRow['type']> = Extract<ExerciseRow, { type: T }>;

export interface ExerciseContext {
  lexicon: Lexicon<LexItem>;
  strictCaps: boolean;
  autoplay: boolean;
}

export interface ExerciseProps<E> {
  exercise: E;
  ctx: ExerciseContext;
  /** Called when the learner presses Continue after seeing the result. */
  onComplete: (verdict: Verdict) => void;
}

/** Shared chrome: type label on the left, optional "words in this sentence" helper on the right. */
export function ExerciseFrame({
  icon: Icon,
  label,
  hintTexts,
  ctx,
  children,
}: {
  icon: ComponentType<{ size?: number }>;
  label: string;
  hintTexts: string[];
  ctx: ExerciseContext;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const words = wordsIn(hintTexts, ctx.lexicon);
  return (
    <div className="exercise">
      <div className="exercise-top">
        <span className="exercise-label">
          <Icon size={16} /> {label}
        </span>
        {words.length > 0 && (
          <button className={`btn ghost sm ${open ? 'active' : ''}`} onClick={() => setOpen(!open)} aria-pressed={open}>
            <BookOpen size={16} /> Words
          </button>
        )}
      </div>
      {open && (
        <div className="word-chips">
          {words.map((w) => (
            <button key={w.id} className="word-chip" onClick={() => void player.play(w.tts ?? w.de)}>
              <Word item={w} /> <span className="muted">· {w.en}</span>
            </button>
          ))}
        </div>
      )}
      {children}
    </div>
  );
}

const TITLES: Record<Verdict, string> = { correct: 'Correct', almost: 'Almost', wrong: 'Not quite' };
const NOTES: Record<Note, string> = { typo: 'Check the spelling', caps: 'Mind the capital letters', article: 'Include the article' };

/** Result of a check: verdict, model answer (with audio), and the author's explanation. */
export function FeedbackPanel({
  verdict,
  note,
  speak,
  explanation,
  ctx,
  children,
}: {
  verdict: Verdict;
  note?: Note | undefined;
  speak?: string | undefined;
  explanation?: string | undefined;
  ctx: ExerciseContext;
  children?: ReactNode;
}) {
  useEffect(() => {
    if (speak && ctx.autoplay) void player.play(speak);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const Icon = verdict === 'correct' ? CircleCheck : verdict === 'almost' ? TriangleAlert : CircleX;
  return (
    <div className={`feedback ${verdict}`} role="status">
      <div className="feedback-head">
        <Icon size={20} />
        <strong>{TITLES[verdict]}</strong>
        {note && <span className="muted">· {NOTES[note]}</span>}
      </div>
      {children && (
        <div className="feedback-answer">
          <span>{children}</span>
          {speak && <SpeakButton text={speak} compact />}
        </div>
      )}
      {explanation && (
        <div className="explain">
          <Lightbulb size={16} />
          <span>{explanation}</span>
        </div>
      )}
    </div>
  );
}

/** Check → Continue button; Enter triggers whichever is showing. */
export function ActionBar({
  checked,
  canCheck,
  onCheck,
  onContinue,
  hideCheck = false,
}: {
  checked: boolean;
  canCheck: boolean;
  onCheck: () => void;
  onContinue: () => void;
  /** For exercises that check on selection (multiple choice). */
  hideCheck?: boolean;
}) {
  useKeys({ Enter: () => (checked ? onContinue() : canCheck && onCheck()) });
  if (!checked && hideCheck) return null;
  return (
    <div className="action-bar">
      {checked ? (
        <button className="btn primary lg" onClick={onContinue}>
          Continue <ArrowRight size={18} />
        </button>
      ) : (
        <button className="btn primary lg" disabled={!canCheck} onClick={onCheck}>
          Check
        </button>
      )}
    </div>
  );
}

/** Random order that differs from the solution order, so the puzzle is never pre-solved. */
export function shuffled<T>(items: T[], isSolved?: (order: T[]) => boolean): T[] {
  let out = [...items];
  for (let attempt = 0; attempt < 12; attempt++) {
    out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j]!, out[i]!];
    }
    if (!isSolved?.(out)) break;
  }
  return out;
}
