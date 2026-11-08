import { CircleCheck, CircleX, Clapperboard, FileUp, Trash2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { importVideoFile, isSubtitleFileName, videoFromSubtitles, type VideoParseResult } from '../../core/video';
import { db, deleteVideo, saveVideo } from '../../db';
import { Chip, EmptyState, PageHeader } from '../components';
import { href, navigate, useAsync } from '../hooks';

interface Pending {
  fileName: string;
  text: string;
}

export function VideosPage() {
  const { data: videos, reload } = useAsync(() => db.videos.orderBy('createdAt').reverse().toArray(), []);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; lines: string[] } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');

  async function store(result: VideoParseResult) {
    if (!result.ok) {
      setNotice({ ok: false, lines: result.errors });
      return;
    }
    const row = await saveVideo(db, result.video);
    setNotice({ ok: true, lines: result.warnings });
    reload();
    navigate(href(`videos/${row.id}`));
  }

  async function readFiles(files: FileList | File[]) {
    const file = Array.from(files)[0];
    if (!file) return;
    setNotice(null);
    const text = await file.text();
    if (isSubtitleFileName(file.name)) {
      setPending({ fileName: file.name, text });
      setTitle(file.name.replace(/\.[^.]+$/, ''));
      return;
    }
    await store(importVideoFile(text));
  }

  return (
    <>
      <PageHeader title="Videos" />
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
        <p>Drop a subtitle file from the extension (.json), or a plain .srt / .vtt</p>
        <label className="btn sm">
          Browse
          <input type="file" hidden accept=".json,.yaml,.yml,.srt,.vtt" onChange={(e) => e.target.files && void readFiles(e.target.files)} />
        </label>
      </div>

      {pending && (
        <article className="card result">
          <div className="result-head">
            <strong>{pending.fileName}</strong>
            <span className="muted">needs the video link</span>
          </div>
          <input className="field plain" placeholder="YouTube link" value={url} onChange={(e) => setUrl(e.target.value)} />
          <input className="field plain" placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="row">
            <button
              className="btn primary"
              disabled={!url.trim()}
              onClick={async () => {
                await store(videoFromSubtitles({ text: pending.text, url, title }));
                setPending(null);
              }}
            >
              Import
            </button>
            <button className="btn ghost" onClick={() => setPending(null)}>
              Cancel
            </button>
          </div>
        </article>
      )}

      {notice && (
        <article className="card result">
          <div className="result-head">
            {notice.ok ? <CircleCheck size={20} className="ok" /> : <CircleX size={20} className="err" />}
            <strong>{notice.ok ? 'Imported' : 'Could not import'}</strong>
          </div>
          <ul className={`issues ${notice.ok ? 'warn' : 'err'}`}>
            {notice.lines.map((l, i) => (
              <li key={i}>
                {notice.ok ? <TriangleAlert size={16} /> : <CircleX size={16} />} {l}
              </li>
            ))}
          </ul>
        </article>
      )}

      {videos && videos.length === 0 && !pending && (
        <EmptyState icon={<Clapperboard size={40} />} title="No videos yet">
          <p className="muted">Open a YouTube video and click the extension. The finished subtitles land here.</p>
        </EmptyState>
      )}

      <section className="grid videos">
        {(videos ?? []).map((v) => {
          const translated = v.segments.filter((s) => s.translation).length;
          return (
            <article key={v.id} className="video-card">
              <a href={href(`videos/${v.id}`)} className="video-thumb">
                <img src={`https://i.ytimg.com/vi/${v.video.id}/mqdefault.jpg`} alt="" loading="lazy" />
              </a>
              <div className="video-info">
                <a className="lesson-title" href={href(`videos/${v.id}`)}>
                  <h3>{v.title}</h3>
                </a>
                <div className="muted small">{v.channel}</div>
                <div className="tags">
                  <Chip>{v.segments.length} lines</Chip>
                  <Chip tone={translated === v.segments.length ? 'success' : 'warn'}>{translated === v.segments.length ? 'translated' : `${translated} translated`}</Chip>
                  {v.level && <Chip tone="primary">{v.level}</Chip>}
                </div>
              </div>
              <button
                className="icon-btn danger"
                aria-label={`Delete ${v.title}`}
                title="Delete"
                onClick={async () => {
                  if (confirm(`Delete "${v.title}"?`)) {
                    await deleteVideo(db, v.id);
                    reload();
                  }
                }}
              >
                <Trash2 size={18} />
              </button>
            </article>
          );
        })}
      </section>
    </>
  );
}
