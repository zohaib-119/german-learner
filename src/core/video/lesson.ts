import { importLessonText, slugify, type ImportResult } from '../importer';
import { BASIC_WORDS } from '../vocab';
import type { VideoFile, VideoSegment } from './schema';

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
 * Turns a video's subtitles into a normal lesson: content words and phrases become items
 * (with the video line as their example), and the video's own sentences become
 * listen-and-choose and word-order exercises. Validated by the regular lesson importer.
 */
export function lessonFromVideo(video: VideoFile, { maxListen = 10, maxOrder = 8 } = {}): ImportResult {
  const items: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const example = (s: VideoSegment) => ({ de: s.text, ...(s.translation ? { en: s.translation } : {}) });

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
        example: example(seg),
      });
    }
    for (const p of seg.phrases) {
      const id = slugify(p.text);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      items.push({ id, kind: 'phrase', de: p.text, en: p.meaning, ...(p.note ? { notes: p.note } : {}), example: example(seg) });
    }
  }

  const translated = video.segments.filter((s) => s.translation);
  const spread = <T,>(list: T[], n: number) => (list.length <= n ? list : Array.from({ length: n }, (_, k) => list[Math.floor((k * list.length) / n)]!));
  const exercises: Record<string, unknown>[] = [];

  // Listen and choose: hear a line from the video, pick its meaning among other lines' meanings.
  spread(translated, maxListen).forEach((s, k) => {
    const others = translated.filter((o) => o.translation !== s.translation);
    if (others.length < 2) return;
    const pick = (offset: number) => others[(translated.indexOf(s) + offset) % others.length]!.translation!;
    const wrong = [...new Set([pick(3), pick(7), pick(11)])].filter((w) => w !== s.translation).slice(0, 2);
    const correct = k % (wrong.length + 1);
    const options = [...wrong];
    options.splice(correct, 0, s.translation!);
    exercises.push({ type: 'listen_choose', audio: s.text, options, correct, explanation: s.translation });
  });

  // Word order: rebuild short lines from the video.
  const short = translated.filter((s) => {
    const n = s.text.split(/\s+/).length;
    return n >= 3 && n <= 9;
  });
  spread(short, maxOrder).forEach((s) => {
    exercises.push({ type: 'word_order', prompt_en: s.translation, tokens: s.text.split(/\s+/), answers: [s.text] });
  });

  const lesson = {
    schema_version: 1,
    id: `video-${video.video.id}`,
    title: `Video · ${video.title}`,
    tags: ['video', ...(video.level ? [video.level] : [])],
    source: `https://www.youtube.com/watch?v=${video.video.id}`,
    items,
    exercises,
  };
  return importLessonText(JSON.stringify(lesson), 'video-lesson.json');
}
