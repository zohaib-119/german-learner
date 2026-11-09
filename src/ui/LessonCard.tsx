import { Layers, Lock, MessageSquareText } from 'lucide-react';
import type { LessonProgress } from '../db/progress';
import { Chip, ProgressBar } from './components';
import { href } from './hooks';

export function LessonCard({ p }: { p: LessonProgress }) {
  const { lesson, words, due, unlocked } = p;
  const hasSentences = p.sentences.total + p.exercises.total > 0;
  return (
    <article className={`lesson-card ${lesson.enabled ? '' : 'disabled'}`}>
      <a className="lesson-title" href={href(`lessons/${lesson.id}`)}>
        <h3>{lesson.title}</h3>
      </a>
      {lesson.tags.length > 0 && (
        <div className="tags">
          {lesson.tags.map((t) => (
            <Chip key={t}>{t}</Chip>
          ))}
        </div>
      )}
      <div className="lesson-progress">
        <ProgressBar value={words.learned} max={words.total} tone="success" label="Words learned" />
        <span className="muted">
          {words.learned}/{words.total}
        </span>
      </div>
      <div className="lesson-actions">
        <a className="btn primary sm" href={href('study/words', { lesson: lesson.id })}>
          <Layers size={16} /> Words {due.words > 0 && <span className="badge">{due.words}</span>}
        </a>
        {hasSentences && (
          <a
            className={`btn sm ${unlocked ? '' : 'locked'}`}
            href={unlocked ? href('study/sentences', { lesson: lesson.id }) : href(`lessons/${lesson.id}`)}
            title={unlocked ? 'Practice sentences' : 'Learn more words to unlock'}
          >
            {unlocked ? <MessageSquareText size={16} /> : <Lock size={16} />} Sentences{' '}
            {unlocked && due.sentences > 0 && <span className="badge">{due.sentences}</span>}
          </a>
        )}
      </div>
    </article>
  );
}
