import { Clapperboard, Trash2 } from 'lucide-react';
import { db, deleteVideo } from '../../db';
import { Chip, EmptyState, PageHeader } from '../components';
import { href, useAsync } from '../hooks';

/** The video library. Videos are added by the browser extension (see extension/README.md). */
export function VideosPage() {
  const { data: videos, reload } = useAsync(() => db.videos.orderBy('createdAt').reverse().toArray(), []);

  return (
    <>
      <PageHeader title="Videos" />

      {videos && videos.length === 0 && (
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
