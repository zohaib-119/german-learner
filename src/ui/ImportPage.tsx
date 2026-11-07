import { CircleCheck, CircleX, FileUp, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { getAudioSettings, makeEngine } from '../audio/settings';
import { lessonTexts } from '../audio/texts';
import { importLessonText, type ImportResult } from '../core/importer';
import { db, saveLesson } from '../db';
import { PageHeader, ProgressBar } from './components';
import { href } from './hooks';

interface Staged {
  fileName: string;
  result: ImportResult;
  saved?: string;
  progress?: { done: number; total: number };
  audioNote?: string;
}

export function ImportPage() {
  const [staged, setStaged] = useState<Staged[]>([]);
  const [dragging, setDragging] = useState(false);

  async function readFiles(files: FileList | File[]) {
    const out: Staged[] = [];
    for (const f of Array.from(files)) out.push({ fileName: f.name, result: importLessonText(await f.text(), f.name) });
    setStaged(out);
  }

  async function confirm(i: number) {
    const s = staged[i];
    if (!s || !s.result.ok) return;
    const patch = (p: Partial<Staged>) => setStaged((cur) => cur.map((c, j) => (j === i ? { ...c, ...p } : c)));
    const summary = await saveLesson(db, s.result.lesson);
    patch({
      saved: `${summary.created ? 'Imported' : 'Updated'} · ${summary.items} items · ${summary.exercises} exercises${summary.removedItems ? ` · ${summary.removedItems} removed` : ''}`,
    });

    // Pre-generate audio so study sessions never wait on synthesis.
    const settings = await getAudioSettings();
    const engine = makeEngine(settings.engine, settings);
    try {
      await engine.prepare?.(lessonTexts(s.result.lesson), (done, total) => patch({ progress: { done, total } }));
      patch({ audioNote: 'Audio ready' });
    } catch {
      patch({ audioNote: 'Audio not generated · start the TTS service (npm run tts)' });
    }
  }

  return (
    <>
      <PageHeader title="Import" />
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
        <FileUp size={32} />
        <p>Drop .yaml, .json or .csv lesson files</p>
        <label className="btn sm">
          Browse
          <input type="file" multiple hidden accept=".yaml,.yml,.json,.csv" onChange={(e) => e.target.files && void readFiles(e.target.files)} />
        </label>
      </div>

      {staged.map((s, i) => (
        <article key={s.fileName + i} className="card result">
          <div className="result-head">
            {s.result.ok ? <CircleCheck size={20} className="ok" /> : <CircleX size={20} className="err" />}
            <strong>{s.result.ok ? s.result.lesson.title : s.fileName}</strong>
            {s.result.ok && (
              <span className="muted">
                {s.result.lesson.items.length} items · {s.result.lesson.exercises.length} exercises
              </span>
            )}
          </div>
          {s.result.ok ? (
            <>
              {s.result.warnings.length > 0 && (
                <ul className="issues warn">
                  {s.result.warnings.map((w, j) => (
                    <li key={j}>
                      <TriangleAlert size={16} /> {w}
                    </li>
                  ))}
                </ul>
              )}
              {s.saved ? (
                <p className="ok-text">
                  {s.saved} · <a href={href(`lessons/${s.result.lesson.id}`)}>Open</a>
                </p>
              ) : (
                <button className="btn primary" onClick={() => void confirm(i)}>
                  Import
                </button>
              )}
              {s.progress && s.progress.done < s.progress.total && <ProgressBar value={s.progress.done} max={s.progress.total} label="Generating audio" />}
              {s.audioNote && <p className="muted">{s.audioNote}</p>}
            </>
          ) : (
            <ul className="issues err">
              {s.result.errors.map((e, j) => (
                <li key={j}>
                  <CircleX size={16} /> {e}
                </li>
              ))}
            </ul>
          )}
        </article>
      ))}
    </>
  );
}
