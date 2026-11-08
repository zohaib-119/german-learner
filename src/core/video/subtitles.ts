/** A raw subtitle cue as found in SRT/VTT files or YouTube's transcript panel. */
export interface Cue {
  start: number;
  /** Optional: the transcript panel only gives start times. */
  end?: number | undefined;
  text: string;
}

const ENTITIES: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

export function decodeEntities(s: string): string {
  return s
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp|#39);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)));
}

/** Strips markup, speaker arrows and extra whitespace from one cue's text. */
export function cleanCueText(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, ''))
    .replace(/^\s*>>\s*/gm, '')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** "[Musik]", "[Applaus]" and similar sound annotations carry no speech. */
export function isSoundAnnotation(s: string): boolean {
  return /^[\[(♪].*[\])♪]$/.test(s.trim()) || /^♪+$/.test(s.trim());
}

/** "1:05", "01:05:09", "00:00:01,500", "00:01.250" -> seconds. Returns null if it is not a timestamp. */
export function parseTimestamp(s: string): number | null {
  const m = s.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
  if (!m) return null;
  const [, h, min, sec, ms] = m;
  return Number(h ?? 0) * 3600 + Number(min) * 60 + Number(sec) + (ms ? Number(ms.padEnd(3, '0')) / 1000 : 0);
}

export function formatTimestamp(seconds: number, sep: ',' | '.' = ','): string {
  const total = Math.max(0, Math.round(seconds * 1000));
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000) % 60;
  const h = Math.floor(total / 3600000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(ms, 3)}`;
}

const ARROW = /((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)\s*-->\s*((?:\d+:)?\d{1,2}:\d{2}(?:[.,]\d{1,3})?)/;

/** Parses SRT or WebVTT text into cues. Tolerant of headers, NOTE blocks, cue ids and settings. */
export function parseSubtitles(input: string): Cue[] {
  const blocks = input.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const at = lines.findIndex((l) => ARROW.test(l));
    if (at < 0) continue;
    const m = lines[at]!.match(ARROW)!;
    const start = parseTimestamp(m[1]!);
    const end = parseTimestamp(m[2]!);
    if (start === null || end === null) continue;
    const text = cleanCueText(lines.slice(at + 1).join('\n'));
    if (!text || isSoundAnnotation(text)) continue;
    const prev = cues[cues.length - 1];
    if (prev && prev.text === text && start - (prev.end ?? prev.start) < 0.5) {
      prev.end = end; // consecutive duplicate (common in auto-captions)
      continue;
    }
    cues.push({ start, end, text });
  }
  return cues;
}

/** Cues -> SRT text. */
export function toSrt(cues: { start: number; end: number; text: string }[]): string {
  return (
    cues.map((c, i) => `${i + 1}\n${formatTimestamp(c.start)} --> ${formatTimestamp(c.end)}\n${c.text}`).join('\n\n') + '\n'
  );
}

/** Extracts an 11-character YouTube video id from a URL or returns the input if it already is one. */
export function videoIdFromUrl(input: string): string | null {
  const s = input.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  try {
    const u = new URL(s);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0]?.match(/^[\w-]{11}$/) ? u.pathname.slice(1).split('/')[0]! : null;
    if (host.endsWith('youtube.com') || host.endsWith('youtube-nocookie.com')) {
      const v = u.searchParams.get('v');
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = u.pathname.match(/^\/(?:shorts|embed|live|v)\/([\w-]{11})/);
      if (m) return m[1]!;
    }
  } catch {
    /* not a URL */
  }
  return null;
}

/**
 * Parses text copied from YouTube's "Show transcript" panel, where each timestamp is followed by its text:
 *   0:01
 *   Hallo und willkommen
 *   0:04
 *   zu unserem Video
 * Also accepts "0:01 Hallo" on one line, and falls back to SRT/VTT when the text contains "-->".
 */
export function parseTranscriptText(input: string): Cue[] {
  if (input.includes('-->')) return parseSubtitles(input);
  const cues: Cue[] = [];
  let current: Cue | null = null;
  for (const raw of input.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^((?:\d+:)?\d{1,2}:\d{2})(?:\s+(.*))?$/);
    const t = m ? parseTimestamp(m[1]!) : null;
    if (m && t !== null) {
      if (current?.text) cues.push(current);
      current = { start: t, text: cleanCueText(m[2] ?? '') };
    } else if (current) {
      current.text = current.text ? `${current.text} ${cleanCueText(line)}` : cleanCueText(line);
    }
  }
  if (current?.text) cues.push(current);
  return cues.filter((c) => !isSoundAnnotation(c.text));
}
