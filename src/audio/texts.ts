import type { NormalizedExercise, NormalizedItem } from '../core/importer';

/** What should be spoken for an item: the `tts` override if present, otherwise the German text. */
export function spokenText(item: Pick<NormalizedItem, 'de' | 'tts'>): string {
  return item.tts ?? item.de;
}

/** The German sentence an exercise is about, as it should be spoken after answering. */
export function exerciseSpokenText(ex: NormalizedExercise): string {
  switch (ex.type) {
    case 'fill_blank':
      return ex.prompt.replace('___', ex.answer);
    case 'word_order':
    case 'translate':
      return ex.answers[0]!;
    case 'multiple_choice':
      return ex.options[ex.correct]!;
    case 'listen_choose':
      return ex.audio;
  }
}

/** All distinct texts worth pre-generating for a lesson: words, example sentences and exercise answers. */
export function lessonTexts(lesson: { items: NormalizedItem[]; exercises?: NormalizedExercise[] }): string[] {
  const out = new Set<string>();
  for (const it of lesson.items) {
    out.add(spokenText(it));
    if (it.example?.de) out.add(it.example.de);
  }
  for (const ex of lesson.exercises ?? []) out.add(exerciseSpokenText(ex));
  return [...out];
}
