import { parse as parseYaml } from 'yaml';
import { mergeCues } from './lines';
import { buildVideoFile } from './build';
import { normalizeVideo, type VideoParseResult } from './schema';
import { parseSubtitles, videoIdFromUrl } from './subtitles';

/** Reads a finished video file (JSON or YAML). */
export function importVideoFile(text: string): VideoParseResult {
  let data: unknown;
  try {
    data = parseYaml(text); // JSON is valid YAML
  } catch (e) {
    return { ok: false, errors: [`Could not read the file: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`] };
  }
  return normalizeVideo(data);
}

/** Builds a video with German-only subtitles from a plain .srt/.vtt file (no translations yet). */
export function videoFromSubtitles(args: { text: string; url: string; title: string; channel?: string }): VideoParseResult {
  const videoId = videoIdFromUrl(args.url);
  if (!videoId) return { ok: false, errors: ['That is not a valid YouTube link.'] };
  const lines = mergeCues(parseSubtitles(args.text));
  if (lines.length === 0) return { ok: false, errors: ['No subtitle lines found in that file.'] };
  return normalizeVideo(buildVideoFile({ videoId, title: args.title.trim() || `YouTube ${videoId}`, channel: args.channel }, lines, []));
}

/** Detects what kind of file this is by name. */
export function isSubtitleFileName(name: string): boolean {
  return /\.(srt|vtt)$/i.test(name);
}
