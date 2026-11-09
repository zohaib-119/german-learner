import { Clock, FileUp, GraduationCap, Library, Play } from 'lucide-react';
import { db } from '../db';
import { getOverview } from '../db/progress';
import { EmptyState, PageHeader } from './components';
import { href, useAsync } from './hooks';
import { LessonCard } from './LessonCard';

export function HomePage() {
  const { data } = useAsync(() => getOverview(db), []);
  if (!data) return null;

  if (data.lessons.length === 0) {
    return (
      <>
        <PageHeader title="Home" />
        <EmptyState icon={<Library size={40} />} title="No lessons yet">
          <a className="btn primary" href={href('import')}>
            <FileUp size={18} /> Import a lesson
          </a>
        </EmptyState>
      </>
    );
  }

  const active = data.lessons
    .filter((p) => p.lesson.enabled)
    .sort((a, b) => b.due.words + b.due.sentences - (a.due.words + a.due.sentences));

  return (
    <>
      <PageHeader title="Home" />
      <section className="stats">
        <div className="stat stat-due">
          <span className="stat-icon due">
            <Clock size={20} />
          </span>
          <div>
            <b>{data.dueTotal}</b>
            <span>Due</span>
          </div>
          <a className={`btn primary sm ${data.dueTotal === 0 ? 'disabled' : ''}`} aria-disabled={data.dueTotal === 0} href={href('study/review')}>
            <Play size={16} /> Review
          </a>
        </div>
        <div className="stat">
          <span className="stat-icon learned">
            <GraduationCap size={20} />
          </span>
          <div>
            <b>{data.learnedTotal}</b>
            <span>Words learned</span>
          </div>
        </div>
        <div className="stat">
          <span className="stat-icon lessons">
            <Library size={20} />
          </span>
          <div>
            <b>{data.lessons.length}</b>
            <span>Lessons</span>
          </div>
        </div>
      </section>
      <h2 className="section-title">Continue</h2>
      <section className="grid">
        {active.map((p) => (
          <LessonCard key={p.lesson.id} p={p} />
        ))}
      </section>
    </>
  );
}
