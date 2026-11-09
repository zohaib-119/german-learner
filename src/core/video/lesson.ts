import { importLessonText, slugify, type ImportResult } from '../importer';
import { BASIC_WORDS } from '../vocab';
import type { VideoFile } from './schema';

const ITEM_KINDS = new Set(['noun', 'verb', 'adjective', 'adverb']);
const SKIP_KINDS = new Set(['article', 'pronoun', 'number']);

/** "der Bäcker" -> { article: "der", de: "Bäcker" } */
function splitArticle(base: string): { article?: 'der' | 'die' | 'das'; de: string } {
  const m = base.match(/^(der|die|das)\s+(.+)$/i);
  return m ? { article: m[1]!.toLowerCase() as 'der' | 'die' | 'das', de: m[2]! } : { de: base };
}

/** "(I) buy" -> "buy" : the person hint only makes sense inside the sentence. */
const cleanMeaning = (m: string) => m.replace(/^\([^)]*\)\s*/, '').trim() || m;

/**
 * Turns a video's subtitles into a words-only lesson: its content words and phrases become
 * items, each once. Spoken lines are not written sentences (fillers, broken-off phrases), so
 * they are not used as examples or exercises. Validated by the regular lesson importer.
 */
export function lessonFromVideo(video: VideoFile): ImportResult {
  const items: Record<string, unknown>[] = [];
  const seen = new Set<string>();

  for (const seg of video.segments) {
    for (const g of seg.glossary) {
      const kind = (g.kind ?? '').toLowerCase();
      if (SKIP_KINDS.has(kind)) continue;
      const { article, de } = splitArticle((g.base || g.word).trim());
      if (BASIC_WORDS.has(de.toLowerCase())) continue;
      const id = slugify(de);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push({
        id,
        kind: ITEM_KINDS.has(kind) ? kind : 'other',
        de,
        en: cleanMeaning(g.meaning),
        ...(article ? { article } : {}),
      });
    }
    for (const p of seg.phrases) {
      const id = slugify(p.text);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push({ id, kind: 'phrase', de: p.text, en: p.meaning, ...(p.note ? { notes: p.note } : {}) });
    }
  }

  const lesson = {
    schema_version: 1,
    id: `video-${video.video.id}`,
    title: `Video · ${video.title}`,
    tags: ['video', ...(video.level ? [video.level] : [])],
    source: `https://www.youtube.com/watch?v=${video.video.id}`,
    items,
    exercises: [],
  };
  return importLessonText(JSON.stringify(lesson), 'video-lesson.json');
}
