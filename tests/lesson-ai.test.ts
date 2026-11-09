import { describe, expect, it } from 'vitest';
import { buildLessonFixPrompt, buildLessonPrompt, lessonIdFor, lessonSize, parseLessonReply } from '../src/core/lesson-ai';

const meta = { videoId: 'kRq3WzSwUw0', title: 'Beim Bäcker' };
const lesson = {
  id: 'whatever',
  title: 'At the bakery',
  tags: ['a1', 'food'],
  items: [
    { kind: 'noun', de: 'Brot', article: 'das', plural: 'Brote', en: 'bread', example: { de: 'Das Brot ist frisch.', en: 'The bread is fresh.' } },
    { kind: 'adjective', de: 'frisch', en: 'fresh', example: { de: 'Das Brot ist frisch.', en: 'The bread is fresh.' } },
  ],
  exercises: [{ type: 'listen_choose', audio: 'Das Brot ist frisch.', options: ['The bread is fresh.', 'The bread is old.'], correct: 0, explanation: 'frisch = fresh' }],
};

describe('buildLessonPrompt', () => {
  const prompt = buildLessonPrompt({ guide: '# Lesson File Format GUIDE', transcript: 'Hallo und willkommen\nHeute gehen wir zum Bäcker.', videoId: 'kRq3WzSwUw0', title: 'Beim Bäcker', level: 'A0' });
  it('includes the format guide, the transcript and the fixed lesson id', () => {
    expect(prompt).toContain('# Lesson File Format GUIDE');
    expect(prompt).toContain('Heute gehen wir zum Bäcker.');
    expect(prompt).toContain(`"id": "${lessonIdFor('kRq3WzSwUw0')}"`);
    expect(prompt).toContain('complete beginner');
  });
  it('asks for written example sentences instead of copied spoken lines', () => {
    expect(prompt).toMatch(/do NOT copy lines/);
  });
  it('scales the lesson size with the transcript', () => {
    expect(lessonSize('kurz').items).toBe(12);
    expect(lessonSize('wort '.repeat(5000)).items).toBe(40);
  });
});

describe('parseLessonReply', () => {
  it('accepts JSON in a code block and sets id, source and the video tag', () => {
    const r = parseLessonReply('Here it is:\n```json\n' + JSON.stringify(lesson) + '\n```', meta);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lesson.id).toBe('yt-kRq3WzSwUw0');
    expect(r.lesson.source).toBe('https://www.youtube.com/watch?v=kRq3WzSwUw0');
    expect(r.lesson.tags).toEqual(['video', 'a1', 'food']);
    expect(r.lesson.items).toHaveLength(2);
    expect(JSON.parse(r.text!).id).toBe('yt-kRq3WzSwUw0');
  });
  it('accepts a bare JSON object (code block text) and YAML', () => {
    expect(parseLessonReply(JSON.stringify(lesson), meta).ok).toBe(true);
    expect(parseLessonReply('```yaml\ntitle: T\nitems:\n  - { de: Brot, en: bread, kind: noun, article: das }\n```', meta).ok).toBe(true);
  });
  it('falls back to the video title', () => {
    const r = parseLessonReply(JSON.stringify({ ...lesson, title: '' }), meta);
    expect(r.ok && r.lesson.title).toBe('Beim Bäcker');
  });
  it('reports invalid lessons with the importer errors', () => {
    const r = parseLessonReply(JSON.stringify({ ...lesson, exercises: [{ type: 'fill_blank', prompt: 'no gap', answer: 'x' }] }), meta);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(' ')).toMatch(/___/);
    expect(parseLessonReply('sorry, I cannot', meta).ok).toBe(false);
  });
  it('lists content words missing from the items so the AI can be asked to add them', () => {
    const r = parseLessonReply(JSON.stringify({ ...lesson, items: [lesson.items[0]] }), meta);
    expect(r.ok && r.missingWords?.[0]).toMatch(/frisch/);
  });
  it('fix prompt lists the problems', () => {
    expect(buildLessonFixPrompt(['items[0].en: Required'])).toContain('- items[0].en: Required');
  });
});
