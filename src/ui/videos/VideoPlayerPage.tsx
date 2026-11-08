import {
  ChevronLeft,
  Download,
  Eye,
  EyeOff,
  Gauge,
  GraduationCap,
  Maximize,
  Minimize,
  Pause,
  Play,
  Repeat1,
  RotateCcw,
  SkipBack,
  SkipForward,
  StepForward,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildLexicon } from '../../core/vocab';
import { stringify as toYaml } from 'yaml';
import { activeIndex, annotateLine, formatTimestamp, lessonFromVideo, toSrt, type GlossEntry, type Part, type VideoSegment } from '../../core/video';
import { db, saveLesson, type VideoRow } from '../../db';
import { SpeakButton } from '../components';
import { href, navigate, useAsync, useKeys } from '../hooks';
import { AnnotatedText } from './AnnotatedText';
import { PlayerState, describePlayerError, loadYouTubeApi, type YTPlayer } from './youtube';

const RATES = [0.5, 0.75, 1, 1.25];
/** Tooltip text: meaning in this line, plus the dictionary form when it differs ("gets up · aufstehen"). */
const glossText = (g: GlossEntry): GlossEntry => ({
  word: g.word,
  meaning: g.base && g.base.toLowerCase() !== g.word.toLowerCase() ? `${g.meaning} · ${g.base}` : g.meaning,
});

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function VideoPlayerPage({ videoId }: { videoId: string }) {
  const { data, loading } = useAsync(async () => {
    const video = await db.videos.get(videoId);
    const items = await db.items.toArray();
    return { video, lexicon: buildLexicon(items) };
  }, [videoId]);

  if (loading) return null;
  if (!data?.video) {
    return (
      <>
        <a className="back" href={href('videos')}>
          <ChevronLeft size={18} /> Videos
        </a>
        <p className="muted">That video was not found.</p>
      </>
    );
  }
  return <Player video={data.video} lexicon={data.lexicon} />;
}

function Player({ video, lexicon }: { video: VideoRow; lexicon: ReturnType<typeof buildLexicon> }) {
  const segments = video.segments;
  const hostRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YTPlayer | null>(null);
  const idxRef = useRef(-1);
  const pausedForRef = useRef(-2);
  const lastTimeRef = useRef<number | null>(null);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [showTr, setShowTr] = useState(false);
  const [autoPause, setAutoPause] = useState(false);
  const [loop, setLoop] = useState(false);
  const [rate, setRate] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [picked, setPicked] = useState<Part | null>(null);

  const flags = useRef({ autoPause, loop, playing });
  flags.current = { autoPause, loop, playing };

  // ---- create the YouTube player ----------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let player: YTPlayer | null = null;
    loadYouTubeApi()
      .then((YT) => {
        if (cancelled || !hostRef.current) return;
        const mount = document.createElement('div');
        hostRef.current.replaceChildren(mount);
        player = new YT.Player(mount, {
          host: 'https://www.youtube-nocookie.com',
          videoId: video.video.id,
          width: '100%',
          height: '100%',
          playerVars: {
            fs: 0, // we provide our own fullscreen so the subtitle bar stays visible
            rel: 0,
            playsinline: 1,
            iv_load_policy: 3,
            cc_load_policy: 0,
            start: Math.max(0, Math.floor((video.lastTime ?? 0) - 2)),
            origin: window.location.origin,
          },
          events: {
            onReady: (e) => {
              playerRef.current = e.target;
              setReady(true);
            },
            onStateChange: (e) => setPlaying(e.data === PlayerState.PLAYING),
            onError: (e) => setError(describePlayerError(e.data)),
          },
        });
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      playerRef.current = null;
      try {
        player?.destroy();
      } catch {
        /* player may not have finished loading */
      }
    };
  }, [video.video.id, video.lastTime]);

  // ---- follow playback: current line, loop, auto-pause, resume position -------------------------
  useEffect(() => {
    if (!ready) return;
    let lastSaved = 0;
    const timer = window.setInterval(() => {
      const p = playerRef.current;
      if (!p) return;
      const t = p.getCurrentTime();
      const i = activeIndex(segments, t);
      const prevIdx = idxRef.current;
      const prevT = lastTimeRef.current;
      lastTimeRef.current = t;

      // A line "ends" either when time reaches its end, or when playback moves on into the next line
      // between two checks. Only normal forward playback counts; seeks must not trigger loop/pause.
      const natural = flags.current.playing && prevT !== null && t >= prevT && t - prevT < 1.2;
      const crossed = natural && prevIdx >= 0 && i > prevIdx;
      const cur = segments[i];
      const atEnd = natural && !!cur && t >= cur.end - 0.06;
      if ((crossed || atEnd) && (flags.current.loop || flags.current.autoPause)) {
        const target = crossed ? prevIdx : i;
        const line = segments[target]!;
        if (flags.current.loop) {
          p.seekTo(line.start, true);
          return;
        }
        if (pausedForRef.current !== target) {
          pausedForRef.current = target;
          p.pauseVideo();
          if (crossed) p.seekTo(Math.max(line.start, line.end - 0.05), true);
          return;
        }
      }
      if (i !== prevIdx) {
        idxRef.current = i;
        pausedForRef.current = -2; // a new line: it may pause again when it ends
        setIdx(i);
      }
      if (flags.current.playing && Date.now() - lastSaved > 5000) {
        lastSaved = Date.now();
        void db.videos.update(video.id, { lastTime: t });
      }
    }, 100);
    return () => window.clearInterval(timer);
  }, [ready, segments, video.id]);

  useEffect(() => {
    const onFs = () => setFullscreen(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  // keep the active transcript row in view
  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [idx]);

  // ---- actions ------------------------------------------------------------------------------------
  const seekTo = useCallback((seg: VideoSegment | undefined, play = true) => {
    const p = playerRef.current;
    if (!p || !seg) return;
    pausedForRef.current = -2;
    p.seekTo(seg.start, true);
    if (play) p.playVideo();
    setPicked(null);
  }, []);
  const toggle = useCallback(() => {
    const p = playerRef.current;
    if (!p) return;
    if (flags.current.playing) p.pauseVideo();
    else p.playVideo();
  }, []);
  const prev = () => seekTo(segments[Math.max(0, idx - 1)]);
  const next = () => seekTo(segments[Math.min(segments.length - 1, idx + 1)]);
  const replay = () => seekTo(segments[Math.max(0, idx)]);
  const setSpeed = (r: number) => {
    setRate(r);
    playerRef.current?.setPlaybackRate(r);
  };
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen();
  };

  useKeys({
    ' ': toggle,
    ArrowLeft: prev,
    ArrowRight: next,
    r: replay,
    l: () => setLoop((v) => !v),
    t: () => setShowTr((v) => !v),
    a: () => setAutoPause((v) => !v),
  });

  // ---- render --------------------------------------------------------------------------------------
  const seg = idx >= 0 ? segments[idx] : undefined;
  const lookup = useCallback(
    (token: string) => {
      const item = lexicon.lookup(token);
      return item ? `${item.article ? `${item.article} ` : ''}${item.de} · ${item.en}` : undefined;
    },
    [lexicon],
  );
  const annotated = useMemo(() => (seg ? annotateLine(seg.text, seg.glossary.map(glossText), lookup) : null), [seg, lookup]);
  const [lessonError, setLessonError] = useState<string | null>(null);
  const createLesson = async () => {
    const r = lessonFromVideo(video);
    if (!r.ok) return setLessonError(r.errors.join('\n'));
    await saveLesson(db, r.lesson);
    navigate(href(`lessons/${r.lesson.id}`));
  };
  const downloadLesson = () => {
    const r = lessonFromVideo(video);
    if (!r.ok) return setLessonError(r.errors.join('\n'));
    const { id, title, tags, source, items, exercises } = r.lesson;
    download(`${id}.yaml`, toYaml({ schema_version: 1, id, title, tags, source, items, exercises }));
  };

  return (
    <>
      <a className="back" href={href('videos')}>
        <ChevronLeft size={18} /> Videos
      </a>
      <div className="vid-layout">
        <div className="vid-main">
          <div ref={stageRef} className={`vid-stage ${fullscreen ? 'is-fs' : ''}`}>
            <div className="vid-frame">
              <div ref={hostRef} className="vid-host" />
              {error && (
                <div className="vid-error">
                  <p>{error}</p>
                  <a className="btn sm" href={`https://www.youtube.com/watch?v=${video.video.id}`} target="_blank" rel="noreferrer">
                    Open on YouTube
                  </a>
                </div>
              )}
            </div>

            <div className="vid-bar" aria-live="polite">
              {seg && annotated ? (
                <>
                  <div className="vid-line">
                    <AnnotatedText annotated={annotated} onPick={(p) => { playerRef.current?.pauseVideo(); setPicked(p); }} />
                  </div>
                  {showTr && seg.translation && <div className="vid-translation">{seg.translation}</div>}
                  {seg.phrases.length > 0 && (
                    <div className="vid-phrases">
                      {seg.phrases.map((p) => (
                        <span key={p.text} className="vid-phrase">
                          <b>{p.text}</b> {p.meaning}
                          {p.note && <i> · {p.note}</i>}
                        </span>
                      ))}
                    </div>
                  )}
                  {annotated.unplaced.length > 0 && (
                    <div className="vid-extra">
                      {annotated.unplaced.map((g) => (
                        <span key={g.word}>
                          <b>{g.word}</b> {g.meaning}
                        </span>
                      ))}
                    </div>
                  )}
                  {picked && (
                    <div className="vid-picked">
                      <span>
                        <b>{picked.text}</b> · {picked.meaning}
                      </span>
                      <SpeakButton text={picked.text} compact />
                      <button className="icon-btn" aria-label="Close" onClick={() => setPicked(null)}>
                        <X size={16} />
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="vid-line muted-line">{ready ? 'Press play' : 'Loading…'}</div>
              )}
            </div>
          </div>

          <div
            className="vid-controls"
            // After a mouse click give focus back to the page so Space always means play/pause.
            // Keyboard activation (detail === 0) keeps focus where it is.
            onClick={(e) => e.detail > 0 && (e.target as HTMLElement).closest('button')?.blur()}
          >
            <button className="icon-btn" title="Previous line (←)" aria-label="Previous line" onClick={prev}>
              <SkipBack size={20} />
            </button>
            <button className="icon-btn big" title="Play / pause (Space)" aria-label={playing ? 'Pause' : 'Play'} onClick={toggle}>
              {playing ? <Pause size={22} /> : <Play size={22} />}
            </button>
            <button className="icon-btn" title="Next line (→)" aria-label="Next line" onClick={next}>
              <SkipForward size={20} />
            </button>
            <button className="icon-btn" title="Replay line (R)" aria-label="Replay line" onClick={replay}>
              <RotateCcw size={20} />
            </button>
            <button className={`icon-btn ${loop ? 'on' : ''}`} title="Loop this line (L)" aria-label="Loop line" aria-pressed={loop} onClick={() => setLoop(!loop)}>
              <Repeat1 size={20} />
            </button>
            <button className={`icon-btn ${autoPause ? 'on' : ''}`} title="Pause after each line (A)" aria-label="Pause after each line" aria-pressed={autoPause} onClick={() => setAutoPause(!autoPause)}>
              <StepForward size={20} />
            </button>
            <button className={`icon-btn ${showTr ? 'on' : ''}`} title="Show translation (T)" aria-label="Show translation" aria-pressed={showTr} onClick={() => setShowTr(!showTr)}>
              {showTr ? <Eye size={20} /> : <EyeOff size={20} />}
            </button>
            <span className="vid-rate" title="Speed">
              <Gauge size={18} />
              {RATES.map((r) => (
                <button key={r} className={`rate-chip ${rate === r ? 'on' : ''}`} onClick={() => setSpeed(r)}>
                  {r}×
                </button>
              ))}
            </span>
            <button className="icon-btn" title="Fullscreen" aria-label="Fullscreen" onClick={toggleFullscreen}>
              {fullscreen ? <Minimize size={20} /> : <Maximize size={20} />}
            </button>
          </div>
          <div className="vid-title-row">
            <div>
              <h1 className="vid-title">{video.title}</h1>
              <div className="muted">{video.channel}</div>
            </div>
            <div className="row">
              <button className="btn primary sm" title="Learn this video's words and phrases as a lesson" onClick={() => void createLesson()}>
                <GraduationCap size={16} /> Create lesson
              </button>
              <button className="btn sm" title="Download as a lesson file (.yaml)" onClick={downloadLesson}>
                <Download size={16} /> Lesson file
              </button>
            </div>
          </div>
          {lessonError && <p className="err small">{lessonError}</p>}
        </div>

        <aside className="vid-side">
          <div className="vid-side-head">
            <h2>Transcript</h2>
            <span className="row">
              <button
                className="btn ghost sm"
                title="Download German subtitles as .srt"
                onClick={() => download(`${video.id}.${video.language}.srt`, toSrt(segments.map((s) => ({ start: s.start, end: s.end, text: s.text }))))}
              >
                <Download size={16} /> SRT
              </button>
              {segments.some((s) => s.translation) && (
                <button
                  className="btn ghost sm"
                  title="Download translated subtitles as .srt"
                  onClick={() => download(`${video.id}.${video.translation_language}.srt`, toSrt(segments.map((s) => ({ start: s.start, end: s.end, text: s.translation ?? s.text }))))}
                >
                  <Download size={16} /> {video.translation_language.toUpperCase()}
                </button>
              )}
            </span>
          </div>
          <div className="vid-list" ref={listRef}>
            {segments.map((s, i) => (
              <button key={i} className={`vid-row ${i === idx ? 'active' : ''}`} data-active={i === idx} onClick={() => seekTo(s)}>
                <span className="vid-time">{fmt(s.start)}</span>
                <span>
                  <span className="vid-row-text">{s.text}</span>
                  {showTr && s.translation && <span className="vid-row-tr">{s.translation}</span>}
                </span>
              </button>
            ))}
          </div>
          <div className="muted small" title={formatTimestamp(video.duration ?? 0)}>
            Keys: Space play · ← → line · R replay · L loop · T translation · A pause after line
          </div>
        </aside>
      </div>
    </>
  );
}
