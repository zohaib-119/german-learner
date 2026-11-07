import { CircleCheck, Lock, X } from 'lucide-react';
import { buildSession, type Stage } from '../../core/session';
import { getLearningSettings } from '../../core/settings';
import { db } from '../../db';
import { getLessonProgress } from '../../db/progress';
import { EmptyState } from '../components';
import { href, navigate, useAsync } from '../hooks';
import { StudySession } from './StudySession';

/** Loads a session plan for `#/study/<stage>?lesson=<id>` and hands it to the runner. */
export function StudyRoute({ stage, lessonId }: { stage: Stage; lessonId: string | null }) {
  const exitTo = lessonId ? href(`lessons/${lessonId}`) : href('');
  const { data } = useAsync(async () => {
    const learning = await getLearningSettings();
    const plan = await buildSession(db, { stage, ...(lessonId ? { lessonId } : {}), newLimit: learning.newPerSession });
    const progress = lessonId ? await getLessonProgress(db, lessonId) : null;
    return { learning, plan, locked: stage === 'sentences' && !!progress && !progress.unlocked };
  }, [stage, lessonId]);

  if (!data) return <div className="study" />;
  if (data.plan.entries.length === 0) {
    return (
      <div className="study">
        <header className="study-top">
          <button className="icon-btn" aria-label="Close" onClick={() => navigate(exitTo)}>
            <X size={22} />
          </button>
        </header>
        <main className="study-main">
          <EmptyState icon={data.locked ? <Lock size={40} /> : <CircleCheck size={40} />} title={data.locked ? 'Sentences are locked' : 'All caught up'}>
            <button className="btn primary" onClick={() => navigate(exitTo)}>
              Back
            </button>
          </EmptyState>
        </main>
      </div>
    );
  }
  return <StudySession plan={data.plan} learning={data.learning} exitTo={exitTo} />;
}
