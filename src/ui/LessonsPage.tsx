import { FileUp, Library } from 'lucide-react';
import { db } from '../db';
import { getOverview } from '../db/progress';
import { EmptyState, PageHeader } from './components';
import { href, useAsync } from './hooks';
import { LessonCard } from './LessonCard';

export function LessonsPage() {
  const { data } = useAsync(() => getOverview(db), []);
  if (!data) return null;
  return (
    <>
      <PageHeader title="Lessons">
        <a className="btn sm" href={href('import')}>
          <FileUp size={16} /> Import
        </a>
      </PageHeader>
      {data.lessons.length === 0 ? (
        <EmptyState icon={<Library size={40} />} title="No lessons yet" />
      ) : (
        <section className="grid">
          {data.lessons.map((p) => (
            <LessonCard key={p.lesson.id} p={p} />
          ))}
        </section>
      )}
    </>
  );
}
