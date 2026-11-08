import type { Line } from './lines';
import type { AiItem } from './prompt';
import type { VideoFileInput } from './schema';

export interface VideoMeta {
  videoId: string;
  title: string;
  channel?: string | undefined;
  duration?: number | undefined;
  language?: string | undefined;
  translationLanguage?: string | undefined;
  level?: string | undefined;
}

/**
 * Combines the real subtitle lines (text and timing come from YouTube, never from the AI) with the
 * AI's translations and word meanings. Lines the AI did not answer keep their text without translation.
 */
export function buildVideoFile(meta: VideoMeta, lines: Line[], replies: AiItem[]): VideoFileInput {
  const byLine = new Map(replies.map((r) => [r.i, r]));
  return {
    kind: 'video',
    schema_version: 1,
    id: `yt-${meta.videoId}`,
    title: meta.title,
    ...(meta.channel ? { channel: meta.channel } : {}),
    video: { provider: 'youtube', id: meta.videoId },
    language: meta.language ?? 'de',
    translation_language: meta.translationLanguage ?? 'en',
    ...(meta.level ? { level: meta.level } : {}),
    ...(meta.duration ? { duration: meta.duration } : {}),
    segments: lines.map((l, idx) => {
      const r = byLine.get(idx + 1);
      return {
        start: round(l.start),
        end: round(l.end),
        text: l.text,
        ...(r ? { translation: r.t } : {}),
        glossary: (r?.g ?? []).map((g) => ({ word: g.w, meaning: g.m, ...(g.b ? { base: g.b } : {}), ...(g.k ? { kind: g.k } : {}) })),
        phrases: (r?.p ?? []).map((x) => ({ text: x.p, meaning: x.m, ...(x.n ? { note: x.n } : {}) })),
      };
    }),
  };
}

const round = (n: number) => Math.round(n * 1000) / 1000;
