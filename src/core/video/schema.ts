import { z } from 'zod';

/** Version of the video file format. Bump and add a migration when it changes. */
export const VIDEO_SCHEMA_VERSION = 1;

const text = z.string().trim().min(1);

export const GlossEntrySchema = z.object({
  /** The word or phrase exactly as it is written in the subtitle line (used for highlighting). */
  word: text,
  /** Short meaning in the learner's language. */
  meaning: text,
});

export const SegmentSchema = z.object({
  /** Seconds from the start of the video. */
  start: z.number().min(0),
  end: z.number().min(0),
  text: text,
  translation: z.string().trim().optional(),
  glossary: z.array(GlossEntrySchema).default([]),
});

export const YOUTUBE_ID = /^[\w-]{11}$/;

export const VideoFileSchema = z.object({
  kind: z.literal('video'),
  schema_version: z.number().int().default(VIDEO_SCHEMA_VERSION),
  /** Stable id of this subtitle set. Defaults to `yt-<videoId>`. */
  id: z.string().regex(/^[\w.\-]+$/, 'use letters, digits, _ . - only').optional(),
  title: text,
  channel: z.string().trim().optional(),
  video: z.object({
    provider: z.literal('youtube'),
    id: z.string().regex(YOUTUBE_ID, 'not a valid YouTube video id'),
  }),
  /** Language of the spoken video / subtitle text, e.g. "de". */
  language: z.string().default('de'),
  /** Language of the translations and meanings, e.g. "en". */
  translation_language: z.string().default('en'),
  level: z.string().optional(),
  duration: z.number().positive().optional(),
  segments: z.array(SegmentSchema).min(1, 'a video needs at least one subtitle line'),
});

export type GlossEntry = z.infer<typeof GlossEntrySchema>;
export type VideoSegment = z.infer<typeof SegmentSchema>;
export type VideoFileInput = z.input<typeof VideoFileSchema>;

/** A validated, normalised video file ready to be stored. */
export interface VideoFile {
  kind: 'video';
  schema_version: number;
  id: string;
  title: string;
  channel?: string | undefined;
  video: { provider: 'youtube'; id: string };
  language: string;
  translation_language: string;
  level?: string | undefined;
  duration?: number | undefined;
  segments: VideoSegment[];
}

export type VideoParseResult = { ok: true; video: VideoFile; warnings: string[] } | { ok: false; errors: string[] };

/**
 * Validates a parsed video object and normalises it: sorts lines by time, repairs end times,
 * and derives the id. Never throws.
 */
export function normalizeVideo(raw: unknown): VideoParseResult {
  const parsed = VideoFileSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((i) => {
        const path = i.path.filter((p): p is string | number => typeof p !== 'symbol');
        return `${path.map((p, n) => (typeof p === 'number' ? `[${p}]` : n === 0 ? p : `.${p}`)).join('') || '(file)'}: ${i.message}`;
      }),
    };
  }
  const warnings: string[] = [];
  const d = parsed.data;
  if (d.schema_version > VIDEO_SCHEMA_VERSION) {
    return { ok: false, errors: [`schema_version ${d.schema_version} is newer than this app supports (${VIDEO_SCHEMA_VERSION})`] };
  }
  const segments = [...d.segments].sort((a, b) => a.start - b.start);
  segments.forEach((s, i) => {
    const next = segments[i + 1];
    if (s.end <= s.start) {
      s.end = next ? Math.max(s.start + 0.5, Math.min(next.start, s.start + 6)) : s.start + 4;
      warnings.push(`line ${i + 1}: end time was not after start, repaired`);
    }
  });
  const missing = segments.filter((s) => !s.translation).length;
  if (missing > 0) warnings.push(`${missing} line(s) have no translation`);
  return {
    ok: true,
    warnings,
    video: {
      kind: 'video',
      schema_version: d.schema_version,
      id: d.id ?? `yt-${d.video.id}`,
      title: d.title,
      channel: d.channel,
      video: d.video,
      language: d.language,
      translation_language: d.translation_language,
      level: d.level,
      duration: d.duration,
      segments,
    },
  };
}
