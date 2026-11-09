// Making a normal lesson (docs/LESSON_FORMAT.md) from a video's transcript with an AI chat.
// Used by the browser extension's "Create lesson" job; the result is imported like any lesson file.
// This is separate from the video subtitle files: a lesson is written by the AI from the transcript,
// with proper written example sentences and exercises, instead of reusing spoken lines.
import { parse as parseYaml } from 'yaml';
import { importLessonText, type ImportResult } from './importer';

export interface LessonPromptInput {
  /** The full text of docs/LESSON_FORMAT.md. */
  guide: string;
  /** The video's transcript as plain text, one line per subtitle line. */
  transcript: string;
  videoId: string;
  title: string;
  channel?: string;
  /** e.g. "A0" (complete beginner), "A1" … */
  level: string;
  sourceLanguage?: string;
  targetLanguage?: string;
}

export const lessonIdFor = (videoId: string) => `yt-${videoId}`;
export const videoUrl = (videoId: string) => `https://www.youtube.com/watch?v=${videoId}`;

const LEVEL_TEXT: Record<string, string> = {
  A0: 'a complete beginner who knows no words yet beyond the most basic function words',
};

/** Rough lesson size from the transcript length: short clips get a small lesson, long ones are capped. */
export function lessonSize(transcript: string): { items: number; exercises: number } {
  const words = transcript.split(/\s+/).filter(Boolean).length;
  const items = Math.max(12, Math.min(40, Math.round(words / 25)));
  return { items, exercises: Math.max(8, Math.min(20, Math.round(items / 2))) };
}

export function buildLessonPrompt(i: LessonPromptInput): string {
  const src = i.sourceLanguage ?? 'German';
  const tgt = i.targetLanguage ?? 'English';
  const level = LEVEL_TEXT[i.level] ?? `at level ${i.level}`;
  const { items, exercises } = lessonSize(i.transcript);
  const tagLevel = i.level === 'A0' ? 'a1' : i.level.toLowerCase();
  return [
    `You are preparing a ${src} lesson file for my learning app, made from a YouTube video I want to understand.`,
    `The learner is ${level}. Meanings and explanations are in ${tgt}.`,
    'Follow the format guide at the end (LESSON_FORMAT.md) exactly.',
    '',
    'Requirements:',
    `- "id": "${lessonIdFor(i.videoId)}", "title": a short title for the video's topic, "tags": ["video", "${tagLevel}", plus 1-3 topic tags].`,
    `- "items": about ${items} of the most useful words and phrases from the transcript, most basic and most frequent first. Use the dictionary form (nouns with "article" and "plural", verbs in the infinitive, irregular verbs with "forms"). Include fixed expressions from the video as kind "phrase", and put why the phrase means that (its literal meaning) in "notes".`,
    '- Every item gets one short "example" (de + en). The transcript is spoken language with fillers and broken-off sentences, so do NOT copy lines from it: write a simple, correct, natural written sentence that uses the word the way the video does.',
    '- Every content word used in an example or exercise must also be an item (articles, pronouns and basic auxiliaries are exempt).',
    `- "exercises": about ${exercises}. Mostly recognition: about half "listen_choose", the rest "multiple_choice" and "word_order", at most two "fill_blank"/"translate". No spelling exercises. Every exercise has a short "explanation".`,
    '- Do not invent content that is not in the video; keep sentences at the learner\'s level.',
    '',
    'Reply with the lesson as ONE JSON object inside a single ```json code block, and nothing else. (JSON is accepted by the format.)',
    '',
    '=== VIDEO ===',
    `Title: ${i.title}`,
    ...(i.channel ? [`Channel: ${i.channel}`] : []),
    `Link: ${videoUrl(i.videoId)}`,
    '',
    '=== TRANSCRIPT ===',
    i.transcript.trim(),
    '',
    '=== FORMAT GUIDE (LESSON_FORMAT.md) ===',
    i.guide.trim(),
  ].join('\n');
}

/** Asks the AI to correct its previous answer. */
export function buildLessonFixPrompt(problems: string[]): string {
  return [
    'The app checked your lesson and found these problems:',
    ...problems.slice(0, 30).map((p) => `- ${p}`),
    '',
    'Fix them (add missing words as items with an example) and reply with the COMPLETE corrected lesson as ONE JSON object inside a single ```json code block, and nothing else.',
  ].join('\n');
}

export type LessonReply = (ImportResult & { text?: string }) & { missingWords?: string[] };

/** Takes the text of a code block, or a whole message containing one. */
function unwrap(reply: string): string {
  const fenced = [...reply.matchAll(/```[a-zA-Z]*\s*\n([\s\S]*?)```/g)].map((m) => m[1]!);
  if (fenced.length) return fenced.sort((a, b) => b.length - a.length)[0]!;
  const start = reply.search(/[{]/);
  const end = reply.lastIndexOf('}');
  return start >= 0 && end > start ? reply.slice(start, end + 1) : reply;
}

/**
 * Turns the AI's answer into a validated lesson. The id and source are always set from the video,
 * so the same video always updates the same lesson. Returns the lesson as JSON text for the app.
 */
export function parseLessonReply(reply: string, meta: { videoId: string; title: string }): LessonReply {
  const body = unwrap(reply).trim();
  let data: unknown;
  try {
    data = JSON.parse(body);
  } catch {
    try {
      data = parseYaml(body);
    } catch (e) {
      return { ok: false, errors: [`The answer is not valid JSON: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`] };
    }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, errors: ['The answer is not one lesson object.'] };
  const obj = data as Record<string, unknown>;
  obj.schema_version = 1;
  obj.id = lessonIdFor(meta.videoId);
  obj.source = videoUrl(meta.videoId);
  if (typeof obj.title !== 'string' || !obj.title.trim()) obj.title = meta.title;
  const tags = Array.isArray(obj.tags) ? obj.tags.filter((t): t is string => typeof t === 'string') : [];
  obj.tags = tags.includes('video') ? tags : ['video', ...tags];
  const text = JSON.stringify(obj, null, 2);
  const result = importLessonText(text, 'lesson.json');
  if (!result.ok) return result;
  const missing = result.warnings.find((w) => w.startsWith('Words used in sentences but missing from items'));
  return { ...result, text, missingWords: missing ? [missing] : [] };
}
