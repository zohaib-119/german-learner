import { useEffect, useState } from 'react';
import { spokenText } from '../audio/texts';
import { db, deleteLesson, type ItemRow, type LessonRow } from '../db';
import { SpeakButton } from './SpeakButton';

interface Row {
  lesson: LessonRow;
  items: number;
  exercises: number;
}

export function LessonsPage({ version }: { version: number }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const [openItems, setOpenItems] = useState<ItemRow[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const lessons = await db.lessons.toArray();
      const out: Row[] = [];
      for (const lesson of lessons) {
        out.push({
          lesson,
          items: await db.items.where('lessonId').equals(lesson.id).count(),
          exercises: await db.exercises.where('lessonId').equals(lesson.id).count(),
        });
      }
      if (!cancelled) setRows(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [version, tick]);

  useEffect(() => {
    if (!open) return setOpenItems([]);
    void db.items.where('lessonId').equals(open).toArray().then(setOpenItems);
  }, [open, version, tick]);

  if (rows.length === 0) return <p>No lessons yet. Use the Import tab to add some (see sample-lessons/).</p>;

  return (
    <section>
      {rows.map(({ lesson, items, exercises }) => (
        <article key={lesson.id} className="card">
          <h3>{lesson.title}</h3>
          <p className="meta">
            {items} items · {exercises} exercises {lesson.tags.length > 0 && `· ${lesson.tags.join(', ')}`}
          </p>
          <label>
            <input
              type="checkbox"
              checked={lesson.enabled}
              onChange={async (e) => {
                await db.lessons.update(lesson.id, { enabled: e.target.checked });
                setTick((t) => t + 1);
              }}
            />{' '}
            enabled
          </label>{' '}
          <button onClick={() => setOpen(open === lesson.id ? null : lesson.id)}>{open === lesson.id ? 'Hide' : 'Show items'}</button>{' '}
          <button
            onClick={async () => {
              if (confirm(`Delete "${lesson.title}" and its progress?`)) {
                await deleteLesson(db, lesson.id);
                setTick((t) => t + 1);
              }
            }}
          >
            Delete
          </button>
          {open === lesson.id && (
            <table>
              <tbody>
                {openItems.map((it) => (
                  <tr key={it.uid}>
                    <td>
                      {[it.article, it.de].filter(Boolean).join(' ')} <SpeakButton text={spokenText(it)} />
                      {it.example && (
                        <div className="meta">
                          {it.example.de} <SpeakButton text={it.example.de} />
                        </div>
                      )}
                    </td>
                    <td>{it.plural ? `pl. ${it.plural}` : ''}</td>
                    <td>{it.en}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </article>
      ))}
    </section>
  );
}
