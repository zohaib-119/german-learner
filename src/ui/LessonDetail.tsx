import { BookOpen, ChevronLeft, Headphones, Keyboard, Layers, Lightbulb, Lock, LockOpen, MessageSquareText, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { spokenText } from '../audio/texts';
import { exerciseSpokenText } from '../audio/texts';
import { isLearned, State } from '../core/srs';
import { unlockSentences } from '../core/session';
import { db, deleteLesson } from '../db';
import { UNLOCK_RATIO, cardId, getLessonProgress, isWordItem } from '../db/progress';
import { EXERCISE_ICONS, EXERCISE_LABELS, exercisePrompt } from '../exercises';
import { Chip, EmptyState, ProgressBar, SpeakButton, Switch, Word } from './components';
import { href, navigate, useAsync } from './hooks';

type Tab = 'words' | 'sentences' | 'exercises';

export function LessonDetail({ lessonId }: { lessonId: string }) {
  const [tab, setTab] = useState<Tab>('words');
  const { data, reload } = useAsync(async () => {
    const progress = await getLessonProgress(db, lessonId);
    if (!progress) return null;
    const [items, exercises, cards, stats] = await Promise.all([
      db.items.where('lessonId').equals(lessonId).toArray(),
      db.exercises.where('lessonId').equals(lessonId).toArray(),
      db.cards.where('lessonId').equals(lessonId).toArray(),
      db.exerciseStats.where('lessonId').equals(lessonId).toArray(),
    ]);
    return {
      progress,
      items: items.sort((a, b) => a.order - b.order),
      exercises: exercises.sort((a, b) => a.order - b.order),
      cards: new Map(cards.map((c) => [c.id, c])),
      seenExercises: new Set(stats.map((s) => s.id)),
    };
  }, [lessonId]);

  if (!data) return null;
  const { progress, items, exercises, cards, seenExercises } = data;
  const { lesson, words, sentences, unlocked } = progress;
  const wordItems = items.filter(isWordItem);
  const sentenceItems = items.filter((i) => !isWordItem(i));
  const examples = items.filter((i) => isWordItem(i) && i.example?.de);
  // Words-only lessons (e.g. made from a video) have no Sentences stage at all.
  const hasSentences = sentences.total + progress.exercises.total > 0;

  const status = (uid: string) => {
    const c = cards.get(cardId(uid, 'de_en'));
    if (!c) return <Chip>New</Chip>;
    return isLearned(c.fsrs) ? <Chip tone="success">Learned</Chip> : c.fsrs.state === State.New ? <Chip>New</Chip> : <Chip tone="warn">Learning</Chip>;
  };

  return (
    <>
      <a className="back" href={href('lessons')}>
        <ChevronLeft size={18} /> Lessons
      </a>
      <div className="page-header">
        <div>
          <h1>{lesson.title}</h1>
          {lesson.tags.length > 0 && (
            <div className="tags">
              {lesson.tags.map((t) => (
                <Chip key={t}>{t}</Chip>
              ))}
            </div>
          )}
        </div>
        <div className="page-actions">
          <span className="muted small">In review</span>
          <Switch
            label="Include in review"
            checked={lesson.enabled}
            onChange={async (v) => {
              await db.lessons.update(lessonId, { enabled: v });
              reload();
            }}
          />
          <button
            className="icon-btn danger"
            title="Delete lesson"
            aria-label="Delete lesson"
            onClick={async () => {
              if (confirm(`Delete "${lesson.title}" and all its progress?`)) {
                await deleteLesson(db, lessonId);
                navigate(href('lessons'));
              }
            }}
          >
            <Trash2 size={20} />
          </button>
        </div>
      </div>

      <section className={`stages ${hasSentences ? '' : 'single'}`}>
        <div className="stage-card">
          <div className="stage-head">
            <Layers size={20} /> <h2>Words</h2>
            <span className="muted">
              {words.learned}/{words.total}
            </span>
          </div>
          <ProgressBar value={words.learned} max={words.total} tone="success" label="Words learned" />
          <a className="btn primary" href={href('study/words', { lesson: lessonId })}>
            <Play size={16} /> {words.seen === 0 ? 'Start' : 'Continue'} {progress.due.words > 0 && <span className="badge">{progress.due.words}</span>}
          </a>
        </div>
        {hasSentences && (
          <div className={`stage-card ${unlocked ? '' : 'is-locked'}`}>
            <div className="stage-head">
              {unlocked ? <MessageSquareText size={20} /> : <Lock size={20} />} <h2>Sentences</h2>
              <span className="muted">
                {sentences.seen + progress.exercises.seen}/{sentences.total + progress.exercises.total}
              </span>
            </div>
            <ProgressBar value={sentences.seen + progress.exercises.seen} max={sentences.total + progress.exercises.total} label="Sentences practised" />
            {unlocked ? (
              <a className="btn primary" href={href('study/sentences', { lesson: lessonId })}>
                <Play size={16} /> Practise {progress.due.sentences > 0 && <span className="badge">{progress.due.sentences}</span>}
              </a>
            ) : (
              <div className="row">
                <span className="muted inline">
                  <Lock size={16} /> {Math.round(UNLOCK_RATIO * 100)}% of words
                </span>
                <button
                  className="btn ghost sm"
                  onClick={async () => {
                    await unlockSentences(db, lessonId);
                    reload();
                  }}
                >
                  <LockOpen size={16} /> Unlock
                </button>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="practice">
        <h2>Practice</h2>
        <div className="practice-buttons">
          <a className={`btn ${words.seen === 0 ? 'disabled' : ''}`} aria-disabled={words.seen === 0} href={href('study/reading', { lesson: lessonId })}>
            <BookOpen size={16} /> Reading {progress.due.reading > 0 && <span className="badge">{progress.due.reading}</span>}
          </a>
          <a className={`btn ${words.seen === 0 ? 'disabled' : ''}`} aria-disabled={words.seen === 0} href={href('study/listening', { lesson: lessonId })}>
            <Headphones size={16} /> Listening {progress.due.listening > 0 && <span className="badge">{progress.due.listening}</span>}
          </a>
          <span className="practice-sep" />
          <a
            className={`btn ${words.learned === 0 && progress.due.spelling === 0 ? 'disabled' : ''}`}
            aria-disabled={words.learned === 0 && progress.due.spelling === 0}
            href={href('study/spelling', { lesson: lessonId })}
          >
            <Keyboard size={16} /> Spelling {progress.due.spelling > 0 && <span className="badge">{progress.due.spelling}</span>} <Chip>Optional</Chip>
          </a>
        </div>
      </section>

      {hasSentences && (
        <div className="tabs" role="tablist">
          {(
            [
              ['words', 'Words', wordItems.length],
              ['sentences', 'Sentences', sentenceItems.length + examples.length],
              ['exercises', 'Exercises', exercises.length],
            ] as const
          ).map(([id, label, n]) => (
            <button key={id} role="tab" aria-selected={tab === id} className={`tab ${tab === id ? 'active' : ''}`} onClick={() => setTab(id)}>
              {label} <span className="count">{n}</span>
            </button>
          ))}
        </div>
      )}
      {!hasSentences && (
        <h2 className="section-title">
          Words <span className="count">{wordItems.length}</span>
        </h2>
      )}

      {tab === 'words' &&
        (wordItems.length === 0 ? (
          <EmptyState icon={<Layers size={32} />} title="No words" />
        ) : (
          <div className="list">
            {wordItems.map((it) => (
              <div key={it.uid} className="row-item">
                <div className="row-main">
                  <div className="row-title">
                    <Word item={it} />
                    <SpeakButton text={spokenText(it)} compact />
                  </div>
                  <div className="muted">
                    {it.en}
                    {it.plural && <> · pl. {it.plural}</>}
                  </div>
                </div>
                {status(it.uid)}
              </div>
            ))}
          </div>
        ))}

      {tab === 'sentences' &&
        (sentenceItems.length + examples.length === 0 ? (
          <EmptyState icon={<MessageSquareText size={32} />} title="No sentences" />
        ) : (
          <div className="list">
            {[
              ...sentenceItems.map((it) => ({
                it,
                de: spokenText(it),
                en: it.en,
              })),
              ...examples.map((it) => ({
                it,
                de: it.example!.de,
                en: it.example!.en ?? '',
              })),
            ].map(({ it, de, en }, i) => (
              <div key={`${it.uid}:${i}`} className="row-item">
                <div className="row-main">
                  <div className="row-title">
                    {de} <SpeakButton text={de} compact />
                  </div>
                  {en && <div className="muted">{en}</div>}
                </div>
              </div>
            ))}
          </div>
        ))}

      {tab === 'exercises' &&
        (exercises.length === 0 ? (
          <EmptyState icon={<Lightbulb size={32} />} title="No exercises" />
        ) : (
          <div className="list">
            {exercises.map((ex) => {
              const Icon = EXERCISE_ICONS[ex.type];
              const prompt = exercisePrompt(ex);
              return (
                <div key={ex.uid} className="row-item">
                  <span className="type-icon" title={EXERCISE_LABELS[ex.type]}>
                    <Icon size={18} />
                  </span>
                  <div className="row-main">
                    <div className="row-title">{prompt}</div>
                    <div className="muted">
                      {exerciseSpokenText(ex)} <SpeakButton text={exerciseSpokenText(ex)} compact />
                    </div>
                  </div>
                  {seenExercises.has(ex.uid) ? <Chip tone="success">Practised</Chip> : <Chip>New</Chip>}
                </div>
              );
            })}
          </div>
        ))}
    </>
  );
}
