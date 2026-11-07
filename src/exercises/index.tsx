import { Headphones, Languages, Lightbulb, ListChecks, PenLine, Shuffle, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { clean, gradeOrder, gradeText, type GradeResult, type Verdict } from '../core/grading';
import type { ExerciseRow } from '../db';
import { player } from '../audio/player';
import { exerciseSpokenText } from '../audio/texts';
import { GlossText, PlayCircle, SpeakButton, SpecialChars } from '../ui/components';
import { useKeys } from '../ui/hooks';
import { ActionBar, Choices, ExerciseFrame, FeedbackPanel, shuffled, type Ex, type ExerciseProps } from './shared';

export type { ExerciseContext } from './shared';

// ---- fill in the blank --------------------------------------------------------------------------

function FillBlank({ exercise, ctx, onComplete }: ExerciseProps<Ex<'fill_blank'>>) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<GradeResult | null>(null);
  const [hint, setHint] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const at = exercise.prompt.indexOf('___');
  const before = exercise.prompt.slice(0, at);
  const after = exercise.prompt.slice(at + 3);
  const full = exercise.prompt.replace('___', exercise.answer);

  useEffect(() => ref.current?.focus(), []);
  const check = () => value.trim() && setResult(gradeText(value, [exercise.answer, ...exercise.accept], { strictCaps: ctx.strictCaps }));

  return (
    <ExerciseFrame icon={PenLine} label="Fill in the blank" hintTexts={[full]} ctx={ctx}>
      <p className="sentence">
        <GlossText text={before} lexicon={ctx.lexicon} />
        <input
          ref={ref}
          className={`blank ${result ? result.verdict : ''}`}
          style={{ width: `${Math.max(6, exercise.answer.length + 2)}ch` }}
          value={value}
          disabled={!!result}
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          aria-label="Missing word"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !result && check()}
        />
        <GlossText text={after} lexicon={ctx.lexicon} />
      </p>
      {!result && (
        <div className="row">
          <SpecialChars inputRef={ref} value={value} onChange={setValue} />
          {exercise.hint && (
            <button className="btn ghost sm" onClick={() => setHint(!hint)}>
              <Lightbulb size={16} /> Hint
            </button>
          )}
        </div>
      )}
      {hint && !result && <p className="hint">{exercise.hint}</p>}
      {result && (
        <FeedbackPanel verdict={result.verdict} note={result.note} speak={full} explanation={exercise.explanation} ctx={ctx}>
          <GlossText text={full} lexicon={ctx.lexicon} />
        </FeedbackPanel>
      )}
      <ActionBar checked={!!result} canCheck={!!value.trim()} onCheck={check} onContinue={() => result && onComplete(result.verdict)} />
    </ExerciseFrame>
  );
}

// ---- word order ---------------------------------------------------------------------------------

function WordOrder({ exercise, ctx, onComplete }: ExerciseProps<Ex<'word_order'>>) {
  const solved = useMemo(() => new Set(exercise.answers.map(clean)), [exercise]);
  const order = useMemo(
    () => shuffled(exercise.tokens.map((_, i) => i), (o) => solved.has(clean(o.map((i) => exercise.tokens[i]!).join(' ')))),
    [exercise, solved],
  );
  const [placed, setPlaced] = useState<number[]>([]);
  const [result, setResult] = useState<GradeResult | null>(null);
  const pool = order.filter((i) => !placed.includes(i));
  const complete = placed.length === exercise.tokens.length;

  const check = () => complete && setResult(gradeOrder(placed.map((i) => exercise.tokens[i]!), exercise.answers));
  useKeys({ Backspace: () => !result && setPlaced((p) => p.slice(0, -1)) });

  return (
    <ExerciseFrame icon={Shuffle} label="Put in order" hintTexts={[exercise.answers[0]!]} ctx={ctx}>
      {exercise.prompt_en && <p className="prompt-en">{exercise.prompt_en}</p>}
      <div className={`slots ${result ? result.verdict : ''}`} aria-label="Your sentence">
        {placed.length === 0 && <span className="slots-empty">Tap the words in order</span>}
        {placed.map((i) => (
          <button key={i} className="tile" disabled={!!result} onClick={() => setPlaced(placed.filter((p) => p !== i))}>
            {exercise.tokens[i]}
          </button>
        ))}
      </div>
      <div className="pool" aria-label="Available words">
        {pool.map((i) => (
          <button key={i} className="tile" disabled={!!result} onClick={() => setPlaced([...placed, i])}>
            {exercise.tokens[i]}
          </button>
        ))}
      </div>
      {!result && placed.length > 0 && (
        <button className="btn ghost sm" onClick={() => setPlaced([])}>
          <Undo2 size={16} /> Reset
        </button>
      )}
      {result && (
        <FeedbackPanel verdict={result.verdict} speak={result.expected} explanation={exercise.explanation} ctx={ctx}>
          <GlossText text={result.expected} lexicon={ctx.lexicon} />
        </FeedbackPanel>
      )}
      <ActionBar checked={!!result} canCheck={complete} onCheck={check} onContinue={() => result && onComplete(result.verdict)} />
    </ExerciseFrame>
  );
}

// ---- translate ----------------------------------------------------------------------------------

function Translate({ exercise, ctx, onComplete }: ExerciseProps<Ex<'translate'>>) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<GradeResult | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const check = () => value.trim() && setResult(gradeText(value, exercise.answers, { strictCaps: ctx.strictCaps }));
  const others = result ? exercise.answers.filter((a) => a !== result.expected) : [];

  return (
    <ExerciseFrame icon={Languages} label="Translate" hintTexts={[exercise.answers[0]!]} ctx={ctx}>
      <p className="prompt-en big">{exercise.prompt}</p>
      <input
        ref={ref}
        className={`field ${result ? result.verdict : ''}`}
        value={value}
        disabled={!!result}
        placeholder="Type in German"
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !result && check()}
      />
      {!result && <SpecialChars inputRef={ref} value={value} onChange={setValue} />}
      {result && (
        <FeedbackPanel verdict={result.verdict} note={result.note} speak={result.expected} explanation={exercise.explanation} ctx={ctx}>
          <GlossText text={result.expected} lexicon={ctx.lexicon} />
          {others.length > 0 && (
            <span className="alt-answers">
              {others.map((a) => (
                <span key={a}>{a}</span>
              ))}
            </span>
          )}
        </FeedbackPanel>
      )}
      <ActionBar checked={!!result} canCheck={!!value.trim()} onCheck={check} onContinue={() => result && onComplete(result.verdict)} />
    </ExerciseFrame>
  );
}

// ---- multiple choice ----------------------------------------------------------------------------

function MultipleChoice({ exercise, ctx, onComplete }: ExerciseProps<Ex<'multiple_choice'>>) {
  const order = useMemo(() => shuffled(exercise.options.map((_, i) => i)), [exercise]);
  const [picked, setPicked] = useState<number | null>(null);
  const verdict: Verdict | null = picked === null ? null : picked === exercise.correct ? 'correct' : 'wrong';
  const choose = (i: number) => picked === null && setPicked(i);
  useKeys(Object.fromEntries(order.map((orig, pos) => [String(pos + 1), () => choose(orig)])), picked === null);

  return (
    <ExerciseFrame icon={ListChecks} label="Choose" hintTexts={[exercise.options[exercise.correct]!]} ctx={ctx}>
      <p className="prompt-en big">
        <GlossText text={exercise.prompt} lexicon={ctx.lexicon} />
      </p>
      <Choices options={exercise.options} order={order} picked={picked} correct={exercise.correct} onPick={choose} />
      {verdict && (
        <FeedbackPanel verdict={verdict} speak={exerciseSpokenText(exercise)} explanation={exercise.explanation} ctx={ctx}>
          <GlossText text={exercise.options[exercise.correct]!} lexicon={ctx.lexicon} />
        </FeedbackPanel>
      )}
      <ActionBar checked={!!verdict} canCheck={false} hideCheck onCheck={() => {}} onContinue={() => verdict && onComplete(verdict)} />
    </ExerciseFrame>
  );
}

// ---- listen and choose (listening recognition) --------------------------------------------------

function ListenChoose({ exercise, ctx, onComplete }: ExerciseProps<Ex<'listen_choose'>>) {
  const order = useMemo(() => shuffled(exercise.options.map((_, i) => i)), [exercise]);
  const [picked, setPicked] = useState<number | null>(null);
  const verdict: Verdict | null = picked === null ? null : picked === exercise.correct ? 'correct' : 'wrong';
  const choose = (i: number) => picked === null && setPicked(i);

  // Listening is the point of this exercise, so it always plays regardless of the auto-play setting.
  useEffect(() => {
    void player.play(exercise.audio);
    return () => player.stop();
  }, [exercise.audio]);
  useKeys({ ' ': () => void player.play(exercise.audio), ...Object.fromEntries(order.map((orig, pos) => [String(pos + 1), () => choose(orig)])) });

  return (
    <ExerciseFrame icon={Headphones} label="Listen and choose" hintTexts={[]} ctx={ctx}>
      <div className="focus">
        <PlayCircle text={exercise.audio} label="Replay" />
        <SpeakButton text={exercise.audio} compact />
      </div>
      {exercise.prompt && <p className="prompt-en">{exercise.prompt}</p>}
      <Choices options={exercise.options} order={order} picked={picked} correct={exercise.correct} onPick={choose} />
      {verdict && (
        <FeedbackPanel verdict={verdict} speak={exercise.audio} explanation={exercise.explanation} ctx={{ ...ctx, autoplay: false }}>
          <GlossText text={exercise.audio} lexicon={ctx.lexicon} />
        </FeedbackPanel>
      )}
      <ActionBar checked={!!verdict} canCheck={false} hideCheck onCheck={() => {}} onContinue={() => verdict && onComplete(verdict)} />
    </ExerciseFrame>
  );
}

// ---- registry: one entry per exercise type ------------------------------------------------------

type Registry = { [K in ExerciseRow['type']]: ComponentType<ExerciseProps<Ex<K>>> };

export const exerciseRegistry: Registry = {
  fill_blank: FillBlank,
  word_order: WordOrder,
  translate: Translate,
  multiple_choice: MultipleChoice,
  listen_choose: ListenChoose,
};

export const EXERCISE_LABELS: Record<ExerciseRow['type'], string> = {
  fill_blank: 'Fill in the blank',
  word_order: 'Put in order',
  translate: 'Translate',
  multiple_choice: 'Choose',
  listen_choose: 'Listen and choose',
};

export const EXERCISE_ICONS: Record<ExerciseRow['type'], ComponentType<{ size?: number }>> = {
  fill_blank: PenLine,
  word_order: Shuffle,
  translate: Languages,
  multiple_choice: ListChecks,
  listen_choose: Headphones,
};

/** Renders the right component for an exercise. Keyed by the caller so state resets between exercises. */
export function ExerciseView(props: ExerciseProps<ExerciseRow>) {
  const Component = exerciseRegistry[props.exercise.type] as ComponentType<ExerciseProps<ExerciseRow>>;
  return <Component {...props} />;
}

/** One-line description of an exercise for lists. */
export function exercisePrompt(ex: ExerciseRow): string {
  switch (ex.type) {
    case 'word_order':
      return ex.prompt_en ?? ex.tokens.join(' · ');
    case 'listen_choose':
      return ex.prompt ?? ex.options.join(' / ');
    default:
      return ex.prompt;
  }
}
