import { useState } from 'react';
import { importLessonText, type ImportResult } from '../core/importer';
import { getAudioSettings, makeEngine } from '../audio/settings';
import { lessonTexts } from '../audio/texts';
import { db, saveLesson } from '../db';

interface Staged {
  fileName: string;
  result: ImportResult;
  saved?: string;
  progress?: { done: number; total: number };
  audioNote?: string;
}

export function ImportPage({ onImported }: { onImported: () => void }) {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);

  async function readFiles(files: FileList | File[]) {
    const out: Staged[] = [];
    for (const f of Array.from(files)) {
      out.push({ fileName: f.name, result: importLessonText(await f.text(), f.name) });
    }
    setStaged(out);
  }

  async function confirm(i: number) {
    const s = staged[i];
    if (!s || !s.result.ok) return;
    const summary = await saveLesson(db, s.result.lesson);
    const msg = `${summary.created ? 'Imported' : 'Updated'}: ${summary.items} items, ${summary.exercises} exercises` +
      (summary.removedItems ? `, ${summary.removedItems} removed` : '');
    const patch = (p: Partial<Staged>) => setStaged((cur) => cur.map((c, j) => (j === i ? { ...c, ...p } : c)));
    patch({ saved: msg });
    onImported();

    // Pre-generate audio so study sessions never wait on synthesis.
    const settings = await getAudioSettings();
    const engine = makeEngine(settings.engine, settings);
    if (engine.prepare) {
      try {
        await engine.prepare(lessonTexts(s.result.lesson), (done, total) => patch({ progress: { done, total } }));
        patch({ audioNote: 'Audio ready.' });
      } catch (e) {
        patch({ audioNote: `Audio pre-generation skipped: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
  }

  return (
    <section>
      <div
        className={`drop ${dragging ? 'dragging' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void readFiles(e.dataTransfer.files);
        }}
      >
        <p>Drop lesson files here (.yaml, .yml, .json, .csv)</p>
        <input type="file" multiple accept=".yaml,.yml,.json,.csv" onChange={(e) => e.target.files && void readFiles(e.target.files)} />
      </div>

      {staged.map((s, i) => (
        <article key={s.fileName + i} className="card">
          <h3>{s.fileName}</h3>
          {s.result.ok ? (
            <>
              <p>
                <strong>{s.result.lesson.title}</strong> (<code>{s.result.lesson.id}</code>) — {s.result.lesson.items.length} items,{' '}
                {s.result.lesson.exercises.length} exercises
              </p>
              {s.result.warnings.length > 0 && (
                <ul className="warn">
                  {s.result.warnings.map((w, j) => (
                    <li key={j}>{w}</li>
                  ))}
                </ul>
              )}
              {s.saved ? <p className="ok">{s.saved}</p> : <button onClick={() => void confirm(i)}>Import</button>}
              {s.progress && s.progress.done < s.progress.total && (
                <progress value={s.progress.done} max={s.progress.total} aria-label="Generating audio" />
              )}
              {s.audioNote && <p className="meta">{s.audioNote}</p>}
            </>
          ) : (
            <ul className="err">
              {s.result.errors.map((e, j) => (
                <li key={j}>{e}</li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </section>
  );
}
