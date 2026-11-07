import { ArrowRight, Eye, Headphones, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { player } from '../../audio/player';
import { spokenText } from '../../audio/texts';
import { gradeVocab, type GradeResult, type Verdict } from '../../core/grading';
import { GRADES, Rating, previewLabels, type Grade } from '../../core/srs';
import type { ExerciseContext } from '../../exercises';
import { ExerciseFrame, FeedbackPanel } from '../../exercises/shared';
import type { ItemRow } from '../../db';
import { Chip, GlossText, PlayCircle, SpeakButton, SpecialChars, Word } from '../components';
import { useKeys } from '../hooks';

/** Play a text when a card appears. Listening cards always play; others follow the autoplay setting. */
function useAutoplay(text: string, enabled: boolean) {
  useEffect(() => {
    if (enabled) void player.play(text);
    return () => player.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);
}

const RATING_META: Record<Grade, { label: string; tone: string }> = {
  [Rating.Again]: { label: 'Again', tone: 'again' },
  [Rating.Hard]: { label: 'Hard', tone: 'hard' },
  [Rating.Good]: { label: 'Good', tone: 'good' },
  [Rating.Easy]: { label: 'Easy', tone: 'easy' },
};

function ItemDetails({ item, ctx }: { item: ItemRow; ctx: ExerciseContext }) {
  return (
    <div className="details">
      {item.plural && <div className="muted">Plural: {item.plural}</div>}
      {item.example && (
        <div className="example">
          <div>
            <GlossText text={item.example.de} lexicon={ctx.lexicon} /> <SpeakButton text={item.example.de} compact />
          </div>
          {item.example.en && <div className="muted">{item.example.en}</div>}
        </div>
      )}
    </div>
  );
}

// ---- first sight of a word ----------------------------------------------------------------------

export function IntroView({ item, ctx, onContinue }: { item: ItemRow; ctx: ExerciseContext; onContinue: () => void }) {
  useAutoplay(spokenText(item), ctx.autoplay);
  useKeys({ Enter: onContinue, ' ': () => void player.play(spokenText(item)) });
  return (
    <div className="stage">
      <Chip tone="primary">
        <Sparkles size={14} /> New
      </Chip>
      <div className="focus">
        <Word item={item} size="xl" />
        <SpeakButton text={spokenText(item)} />
      </div>
      <div className="meaning">{item.en}</div>
      <ItemDetails item={item} ctx={ctx} />
      <div className="action-bar">
        <button className="btn primary lg" onClick={onContinue}>
          Continue <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

// ---- reveal cards: recognition and listening ----------------------------------------------------

export type FlipMode = 'de_en' | 'listen_en' | 'ex_listen';

export function FlipView({
  item,
  mode,
  card,
  ctx,
  onRate,
}: {
  item: ItemRow;
  mode: FlipMode;
  card: import('ts-fsrs').Card;
  ctx: ExerciseContext;
  onRate: (r: Grade) => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const text = mode === 'ex_listen' ? item.example!.de : spokenText(item);
  const listening = mode !== 'de_en';
  useAutoplay(text, listening || ctx.autoplay);
  const labels = previewLabels(card);

  useKeys(
    {
      Enter: () => !revealed && setRevealed(true),
      ' ': () => void player.play(text),
      '1': () => revealed && onRate(Rating.Again),
      '2': () => revealed && onRate(Rating.Hard),
      '3': () => revealed && onRate(Rating.Good),
      '4': () => revealed && onRate(Rating.Easy),
    },
    true,
  );

  return (
    <div className="stage">
      {listening && (
        <Chip>
          <Headphones size={14} /> Listen
        </Chip>
      )}
      <div className="focus">
        {mode === 'de_en' ? (
          <>
            <Word item={item} size="xl" />
            <SpeakButton text={text} />
          </>
        ) : (
          <>
            <PlayCircle text={text} label="Replay" />
            <SpeakButton text={text} />
          </>
        )}
      </div>

      {revealed ? (
        <div className="answer">
          {mode === 'ex_listen' ? (
            <>
              <div className="sentence-lg">
                <GlossText text={item.example!.de} lexicon={ctx.lexicon} />
              </div>
              {item.example!.en && <div className="meaning">{item.example!.en}</div>}
            </>
          ) : (
            <>
              {mode === 'listen_en' && <Word item={item} size="lg" />}
              <div className="meaning">{item.en}</div>
              <ItemDetails item={item} ctx={ctx} />
            </>
          )}
          <div className="ratings">
            {GRADES.map((g, i) => (
              <button key={g} className={`rate ${RATING_META[g].tone}`} onClick={() => onRate(g)}>
                <span className="rate-label">{RATING_META[g].label}</span>
                <span className="rate-interval">{labels[g]}</span>
                <kbd>{i + 1}</kbd>
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="action-bar">
          <button className="btn primary lg" onClick={() => setRevealed(true)}>
            <Eye size={18} /> Show answer
          </button>
        </div>
      )}
    </div>
  );
}

// ---- typed recall: English → German, and dictation ---------------------------------------------

export function TypeView({
  item,
  mode,
  ctx,
  onDone,
}: {
  item: ItemRow;
  mode: 'en_de' | 'listen_type';
  ctx: ExerciseContext;
  onDone: (v: Verdict) => void;
}) {
  const [value, setValue] = useState('');
  const [result, setResult] = useState<GradeResult | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const dictation = mode === 'listen_type';
  useAutoplay(spokenText(item), dictation);
  useEffect(() => ref.current?.focus(), []);

  const check = () => value.trim() && setResult(gradeVocab(value, item, { strictCaps: ctx.strictCaps }));
  useKeys({ Enter: () => result && onDone(result.verdict), ' ': () => void player.play(spokenText(item)) });

  return (
    <ExerciseFrame icon={dictation ? Headphones : ArrowRight} label={dictation ? 'Type what you hear' : 'Type the German'} hintTexts={[]} ctx={ctx}>
      <div className="focus">
        {dictation ? (
          <>
            <PlayCircle text={spokenText(item)} label="Replay" />
            <SpeakButton text={spokenText(item)} />
          </>
        ) : (
          <div className="meaning big">
            {item.en} <Chip>{item.kind}</Chip>
          </div>
        )}
      </div>
      <input
        ref={ref}
        className={`field ${result ? result.verdict : ''}`}
        value={value}
        disabled={!!result}
        placeholder={item.article || item.kind === 'noun' ? 'with article, e.g. das Brot' : 'Type in German'}
        autoCapitalize="off"
        autoComplete="off"
        spellCheck={false}
        aria-label="Your answer"
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && !result && check()}
      />
      {!result && <SpecialChars inputRef={ref} value={value} onChange={setValue} />}
      {result && (
        <FeedbackPanel verdict={result.verdict} note={result.note} speak={spokenText(item)} ctx={ctx}>
          <Word item={item} size="lg" /> <span className="muted">· {item.en}</span>
        </FeedbackPanel>
      )}
      <div className="action-bar">
        {result ? (
          <button className="btn primary lg" onClick={() => onDone(result.verdict)}>
            Continue <ArrowRight size={18} />
          </button>
        ) : (
          <button className="btn primary lg" disabled={!value.trim()} onClick={check}>
            Check
          </button>
        )}
      </div>
    </ExerciseFrame>
  );
}
