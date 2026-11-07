import type { NormalizedItem, NormalizedLesson } from '../core/importer';

/** What should be spoken for an item: the `tts` override if present, otherwise the German text. */
export function spokenText(item: Pick<NormalizedItem, 'de' | 'tts'>): string {
  return item.tts ?? item.de;
}

/** All distinct texts worth pre-generating for a lesson: words/phrases and example sentences. */
export function lessonTexts(lesson: Pick<NormalizedLesson, 'items'>): string[] {
  const out = new Set<string>();
  for (const it of lesson.items) {
    out.add(spokenText(it));
    if (it.example?.de) out.add(it.example.de);
  }
  return [...out];
}
