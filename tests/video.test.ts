import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PROMPT_OPTIONS,
  dedupeCues,
  activeIndex,
  annotateLine,
  buildPrompt,
  buildRetryPrompt,
  buildVideoFile,
  lessonFromVideo,
  chunkLines,
  formatTimestamp,
  mergeCues,
  missingLines,
  normalizeVideo,
  parseAiReply,
  parseSubtitles,
  parseTimestamp,
  parseTranscriptText,
  toSrt,
  videoIdFromUrl,
} from '../src/core/video';

describe('timestamps', () => {
  it('parses SRT, VTT and transcript-panel styles', () => {
    expect(parseTimestamp('00:00:01,500')).toBe(1.5);
    expect(parseTimestamp('01:02.250')).toBe(62.25);
    expect(parseTimestamp('1:05')).toBe(65);
    expect(parseTimestamp('1:02:03')).toBe(3723);
    expect(parseTimestamp('nope')).toBeNull();
  });
  it('formats back to SRT', () => {
    expect(formatTimestamp(3723.456)).toBe('01:02:03,456');
    expect(formatTimestamp(0.5, '.')).toBe('00:00:00.500');
  });
});

describe('parseSubtitles', () => {
  it('reads SRT', () => {
    const cues = parseSubtitles('1\n00:00:01,000 --> 00:00:03,000\nHallo &amp; willkommen\n\n2\n00:00:03,500 --> 00:00:05,000\nHeute geht es\num Brot.\n');
    expect(cues).toEqual([
      { start: 1, end: 3, text: 'Hallo & willkommen' },
      { start: 3.5, end: 5, text: 'Heute geht es um Brot.' },
    ]);
  });
  it('reads VTT with header, settings, tags, NOTE blocks and sound annotations', () => {
    const vtt = `WEBVTT\nKind: captions\n\nNOTE comment\n\n00:01.000 --> 00:02.000 align:start position:0%\n<c.colorE5E5E5>Guten</c> <00:01.500><c>Morgen</c>\n\n00:02.000 --> 00:03.000\n[Musik]\n`;
    expect(parseSubtitles(vtt)).toEqual([{ start: 1, end: 2, text: 'Guten Morgen' }]);
  });
  it('merges consecutive duplicate cues', () => {
    const cues = parseSubtitles('00:00:01,000 --> 00:00:02,000\nHallo\n\n00:00:02,000 --> 00:00:03,000\nHallo\n');
    expect(cues).toEqual([{ start: 1, end: 3, text: 'Hallo' }]);
  });
  it('round-trips through toSrt', () => {
    const cues = [{ start: 1, end: 2.5, text: 'Hallo Welt' }];
    expect(parseSubtitles(toSrt(cues))).toEqual(cues);
  });
});

describe('videoIdFromUrl', () => {
  const id = 'kRq3WzSwUw0';
  it.each([
    `https://www.youtube.com/watch?v=${id}&pp=abc`,
    `https://youtu.be/${id}?t=5`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    id,
  ])('extracts the id from %s', (u) => expect(videoIdFromUrl(u)).toBe(id));
  it('rejects other input', () => {
    expect(videoIdFromUrl('https://example.com/watch?v=kRq3WzSwUw0')).toBeNull();
    expect(videoIdFromUrl('hello')).toBeNull();
  });
});

describe('mergeCues', () => {
  it('merges short fragments into sentence-sized lines and keeps exact times', () => {
    const cues = [
      { start: 0, text: 'Hallo und willkommen' },
      { start: 2, text: 'zu unserem Video.' },
      { start: 4, text: 'Heute sprechen wir' },
      { start: 6, text: 'über Brot' },
    ];
    const lines = mergeCues(cues);
    expect(lines.map((l) => l.text)).toEqual(['Hallo und willkommen zu unserem Video.', 'Heute sprechen wir über Brot']);
    expect(lines[0]).toMatchObject({ start: 0, end: 4 });
    expect(lines[1]!.start).toBe(4);
  });
  it('starts a new line after a long pause or when too long', () => {
    expect(mergeCues([{ start: 0, end: 1, text: 'eins' }, { start: 10, end: 11, text: 'zwei' }]).map((l) => l.text)).toEqual(['eins', 'zwei']);
    const long = Array.from({ length: 8 }, (_, i) => ({ start: i, end: i + 1, text: 'wort wort wort' }));
    expect(mergeCues(long).every((l) => l.text.length <= 90)).toBe(true);
  });
  it('drops sound annotations and never produces zero-length lines', () => {
    const lines = mergeCues([{ start: 0, text: '[Musik]' }, { start: 1, text: 'Hallo' }]);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.end).toBeGreaterThan(lines[0]!.start);
  });
});

describe('prompt + chunks', () => {
  const lines = Array.from({ length: 95 }, (_, i) => ({ start: i, end: i + 1, text: `Satz ${i + 1}` }));
  it('chunks with global 1-based numbering', () => {
    const chunks = chunkLines(lines, { maxLines: 40 });
    expect(chunks).toHaveLength(3);
    expect(chunks[0]!.lines[0]!.i).toBe(1);
    expect(chunks[1]!.lines[0]!.i).toBe(41);
    expect(chunks[2]!.lines.at(-1)!.i).toBe(95);
  });
  it('builds a prompt with the lines, level and no code fences', () => {
    const [chunk] = chunkLines(lines.slice(0, 3));
    const p = buildPrompt(chunk!, 1, { ...DEFAULT_PROMPT_OPTIONS, level: 'A1', title: 'Beim Bäcker' });
    expect(p).toContain('1 | Satz 1');
    expect(p).toContain('A1 learner');
    expect(p).toContain('"Beim Bäcker"');
    expect(p).not.toContain('```');
  });
  it('retry prompt lists only the missing lines', () => {
    const [chunk] = chunkLines(lines.slice(0, 5));
    const p = buildRetryPrompt([2, 4], chunk!, DEFAULT_PROMPT_OPTIONS);
    expect(p).toContain('2 | Satz 2');
    expect(p).toContain('4 | Satz 4');
    expect(p).not.toContain('3 | Satz 3');
  });
});

describe('parseAiReply', () => {
  const good = `[{"i":1,"t":"Hello","g":[{"w":"Brot","m":"bread (das Brot)"}]},{"i":2,"t":"Bye","g":[]}]`;
  it('reads a fenced code block with surrounding prose', () => {
    const items = parseAiReply(`Sure! Here you go:\n\`\`\`json\n${good}\n\`\`\`\nHope it helps [1].`);
    expect(items.map((x) => x.i)).toEqual([1, 2]);
    expect(items[0]!.g[0]).toEqual({ w: 'Brot', m: 'bread (das Brot)' });
  });
  it('reads bare JSON, wrapper objects and alternative key names', () => {
    expect(parseAiReply(good)).toHaveLength(2);
    expect(parseAiReply(`{"lines": ${good}}`)).toHaveLength(2);
    const alt = parseAiReply(`[{"index":"3","translation":"Hi","glossary":[{"word":"Hallo","meaning":"hello"}]}]`);
    expect(alt).toEqual([{ i: 3, t: 'Hi', g: [{ w: 'Hallo', m: 'hello' }], p: [] }]);
  });
  it('handles brackets inside strings and ignores invalid entries', () => {
    const items = parseAiReply(`[{"i":1,"t":"a [b] c","g":[]},{"i":"x","t":"bad"},{"i":2,"t":""}]`);
    expect(items).toEqual([{ i: 1, t: 'a [b] c', g: [], p: [] }]);
  });
  it('returns nothing for text without JSON or with truncated JSON', () => {
    expect(parseAiReply('I cannot do that.')).toEqual([]);
    expect(parseAiReply('[{"i":1,"t":"cut off"')).toEqual([]);
  });
  it('reports missing lines', () => {
    const [chunk] = chunkLines([1, 2, 3].map((n) => ({ start: n, end: n + 1, text: `s${n}` })));
    expect(missingLines(chunk!, parseAiReply(`[{"i":2,"t":"x","g":[]}]`))).toEqual([1, 3]);
  });
});

describe('buildVideoFile + normalizeVideo', () => {
  const lines = [
    { start: 0, end: 3, text: 'Ich esse Brot.' },
    { start: 3, end: 6, text: 'Er steht auf.' },
  ];
  const meta = { videoId: 'kRq3WzSwUw0', title: 'Test', channel: 'Easy German', level: 'A1' };
  it('keeps AI text out of timing and text, and validates', () => {
    const file = buildVideoFile(meta, lines, [{ i: 1, t: 'I eat bread.', g: [{ w: 'Brot', m: 'bread', b: 'das Brot', k: 'noun' }], p: [] }, { i: 2, t: 'He gets up.', g: [], p: [{ p: 'steht auf', m: 'gets up', n: 'aufstehen = stand up' }] }]);
    const r = normalizeVideo(file);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.video.id).toBe('yt-kRq3WzSwUw0');
    expect(r.video.segments.map((s) => s.text)).toEqual(['Ich esse Brot.', 'Er steht auf.']);
    expect(r.video.segments[0]!.translation).toBe('I eat bread.');
    expect(r.video.segments[0]!.glossary[0]).toEqual({ word: 'Brot', meaning: 'bread', base: 'das Brot', kind: 'noun' });
    expect(r.video.segments[1]!.phrases).toEqual([{ text: 'steht auf', meaning: 'gets up', note: 'aufstehen = stand up' }]);
    expect(r.warnings).toEqual([]);
  });
  it('warns about untranslated lines and repairs bad end times and ordering', () => {
    const file = buildVideoFile(meta, [{ start: 5, end: 5, text: 'zwei' }, { start: 1, end: 4, text: 'eins' }], []);
    const r = normalizeVideo(file);
    expect(r.ok && r.video.segments.map((s) => s.text)).toEqual(['eins', 'zwei']);
    expect(r.ok && r.video.segments[1]!.end).toBeGreaterThan(5);
    expect(r.ok && r.warnings.join()).toMatch(/no translation/);
  });
  it('rejects invalid files with located errors', () => {
    const bad = normalizeVideo({ kind: 'video', title: 'x', video: { provider: 'youtube', id: 'short' }, segments: [] });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.join('\n')).toMatch(/video\.id|segments/);
    expect(normalizeVideo({ kind: 'lesson' }).ok).toBe(false);
  });
});

describe('annotateLine', () => {
  const gl = [
    { word: 'steht auf', meaning: 'gets up (aufstehen)' },
    { word: 'Brot', meaning: 'bread (das Brot)' },
    { word: 'Käse', meaning: 'cheese' },
  ];
  it('highlights words and phrases case-insensitively without splitting letters', () => {
    const { parts, unplaced } = annotateLine('Er steht früh auf. Er steht auf und isst brot.', gl);
    const marked = parts.filter((p) => p.meaning).map((p) => p.text);
    expect(marked).toEqual(['steht auf', 'brot']);
    expect(parts.map((p) => p.text).join('')).toBe('Er steht früh auf. Er steht auf und isst brot.');
    expect(unplaced.map((u) => u.word)).toEqual(['Käse']);
  });
  it('highlights both parts of a separable verb that is split in the line', () => {
    const { parts, unplaced } = annotateLine('Er steht früh auf.', [{ word: 'steht auf', meaning: 'gets up (aufstehen)' }]);
    expect(parts.filter((p) => p.meaning).map((p) => p.text)).toEqual(['steht', 'auf']);
    expect(unplaced).toEqual([]);
    // parts out of order are not a match
    expect(annotateLine('Auf steht er.', [{ word: 'steht auf', meaning: 'x' }]).unplaced).toHaveLength(1);
  });
  it('does not match inside longer words', () => {
    expect(annotateLine('Brotmesser', [gl[1]!]).parts.some((p) => p.meaning)).toBe(false);
  });
  it('falls back to the learner vocabulary lookup', () => {
    const { parts } = annotateLine('Ich esse Käse', [], (t) => (t.toLowerCase() === 'käse' ? 'cheese' : undefined));
    expect(parts.find((p) => p.source === 'vocab')).toMatchObject({ text: 'Käse', meaning: 'cheese' });
  });
});

describe('activeIndex', () => {
  const segs = [{ start: 0, end: 2 }, { start: 2, end: 5 }, { start: 8, end: 9 }];
  it('finds the current line by time', () => {
    expect(activeIndex(segs, -1)).toBe(-1);
    expect(activeIndex(segs, 0)).toBe(0);
    expect(activeIndex(segs, 4.9)).toBe(1);
    expect(activeIndex(segs, 6)).toBe(1); // in a gap: the previous line stays active
    expect(activeIndex(segs, 100)).toBe(2);
  });
});

describe('parseTranscriptText', () => {
  it('reads the copied transcript panel (timestamp line, then text)', () => {
    expect(parseTranscriptText('0:01\nHallo und\nwillkommen\n0:04\n[Musik]\n1:02:03\nzum Schluss')).toEqual([
      { start: 1, text: 'Hallo und willkommen' },
      { start: 3723, text: 'zum Schluss' },
    ]);
  });
  it('reads "0:01 text" on one line and passes SRT through', () => {
    expect(parseTranscriptText('0:01 Hallo\n0:03 Welt')).toEqual([{ start: 1, text: 'Hallo' }, { start: 3, text: 'Welt' }]);
    expect(parseTranscriptText('1\n00:00:01,000 --> 00:00:02,000\nHi\n')).toEqual([{ start: 1, end: 2, text: 'Hi' }]);
  });
  it('ignores text before the first timestamp', () => {
    expect(parseTranscriptText('Transcript\nSearch\n0:05\nLos geht es')).toEqual([{ start: 5, text: 'Los geht es' }]);
  });
});

describe('dedupeCues', () => {
  it('drops a transcript read twice and repeats a moment later, keeps real repetition', () => {
    const cues = [
      { start: 0, text: 'Hallo und willkommen' },
      { start: 2, text: 'zu unserem Video.' },
      { start: 0, text: 'Hallo und willkommen' },
      { start: 2, text: 'zu unserem Video.' },
      { start: 3, text: 'zu unserem Video.' },
      { start: 60, text: 'Hallo und willkommen' },
    ];
    expect(dedupeCues(cues).map((c) => `${c.start} ${c.text}`)).toEqual(['0 Hallo und willkommen', '2 zu unserem Video.', '60 Hallo und willkommen']);
  });
  it('trims auto-caption overlap and growing roll-up cues', () => {
    const out = dedupeCues([
      { start: 0, text: 'ich gehe heute' },
      { start: 2, text: 'gehe heute zum Bäcker' },
      { start: 10, text: 'das ist' },
      { start: 11, text: 'das ist gut' },
    ]);
    expect(out.map((c) => c.text)).toEqual(['ich gehe heute', 'zum Bäcker', 'das ist gut']);
    expect(out[2]!.start).toBe(10);
  });
  it('mergeCues uses it, so lines are never doubled', () => {
    const lines = mergeCues([{ start: 0, text: 'Guten Morgen.' }, { start: 0, text: 'Guten Morgen.' }, { start: 3, text: 'Wie geht es?' }]);
    expect(lines.map((l) => l.text)).toEqual(['Guten Morgen.', 'Wie geht es?']);
  });
});

describe('prompt modes', () => {
  const [chunk] = chunkLines([{ start: 0, end: 1, text: 'Ich kaufe Brot.' }]);
  it('beginner default explains every word, repeated ones included, and asks for phrases', () => {
    const p = buildPrompt(chunk!, 1, DEFAULT_PROMPT_OPTIONS);
    expect(p).toContain('complete beginner');
    expect(p).toContain('EVERY word of the line');
    expect(p).toContain('explain it again there');
    expect(p).toContain('"p"');
    expect(p).toContain('literal');
  });
  it('"hard" mode keeps the short list', () => {
    const p = buildPrompt(chunk!, 1, { ...DEFAULT_PROMPT_OPTIONS, level: 'B1', glossMode: 'hard' });
    expect(p).toContain('B1 learner');
    expect(p).not.toContain('EVERY word of the line');
  });
  it('defaults to small chunks because beginner replies are long', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ start: i, end: i + 1, text: `Satz ${i}` }));
    expect(chunkLines(many)[0]!.lines).toHaveLength(15);
  });
  it('parses dictionary form, word type and phrases', () => {
    const [item] = parseAiReply('[{"i":1,"t":"I buy bread.","g":[{"w":"kaufe","b":"kaufen","k":"verb","m":"(I) buy"}],"p":[{"p":"Lust haben","m":"to feel like","n":"literally: to have desire"}]}]');
    expect(item!.g[0]).toEqual({ w: 'kaufe', m: '(I) buy', b: 'kaufen', k: 'verb' });
    expect(item!.p[0]).toEqual({ p: 'Lust haben', m: 'to feel like', n: 'literally: to have desire' });
  });
});

describe('lessonFromVideo', () => {
  const file = buildVideoFile({ videoId: 'kRq3WzSwUw0', title: 'Beim Bäcker', level: 'A0' }, [
    { start: 0, end: 3, text: 'Ich kaufe das Brot.' },
    { start: 3, end: 6, text: 'Der Bäcker steht früh auf.' },
    { start: 6, end: 9, text: 'Wie geht es dir?' },
    { start: 9, end: 12, text: 'Ich kaufe noch ein Brot.' },
  ], [
    { i: 1, t: 'I buy the bread.', g: [{ w: 'Ich', m: 'I', k: 'pronoun' }, { w: 'kaufe', b: 'kaufen', k: 'verb', m: '(I) buy' }, { w: 'das', m: 'the', k: 'article' }, { w: 'Brot', b: 'das Brot', k: 'noun', m: 'bread' }], p: [] },
    { i: 2, t: 'The baker gets up early.', g: [{ w: 'Bäcker', b: 'der Bäcker', k: 'noun', m: 'baker' }, { w: 'steht auf', b: 'aufstehen', k: 'verb', m: 'gets up' }, { w: 'früh', b: 'früh', k: 'adverb', m: 'early' }], p: [] },
    { i: 3, t: 'How are you?', g: [{ w: 'Wie', m: 'how', k: 'adverb' }], p: [{ p: 'Wie geht es dir?', m: 'How are you?', n: 'literally: how goes it to you' }] },
    { i: 4, t: 'I buy another bread.', g: [{ w: 'kaufe', b: 'kaufen', k: 'verb', m: '(I) buy' }, { w: 'Brot', b: 'das Brot', k: 'noun', m: 'bread' }], p: [] },
  ]);
  const r = normalizeVideo(file);
  if (!r.ok) throw new Error('fixture invalid');
  const lesson = lessonFromVideo(r.video);

  it('creates a valid lesson from the video', () => {
    expect(lesson.ok).toBe(true);
  });
  it('turns content words into items with dictionary form and article', () => {
    if (!lesson.ok) return;
    const byId = Object.fromEntries(lesson.lesson.items.map((i) => [i.id, i]));
    expect(byId.brot).toMatchObject({ de: 'Brot', article: 'das', kind: 'noun', en: 'bread' });
    expect(byId.kaufen).toMatchObject({ de: 'kaufen', kind: 'verb', en: 'buy' });
    expect(byId.aufstehen).toMatchObject({ kind: 'verb', en: 'gets up' });
    expect(byId['ich']).toBeUndefined(); // pronoun / basic word
    expect(byId['das']).toBeUndefined(); // article
    expect(lesson.lesson.items.filter((i) => i.id === 'kaufen')).toHaveLength(1); // repeated word appears once
  });
  it('turns phrases into phrase items with their explanation', () => {
    if (!lesson.ok) return;
    expect(lesson.lesson.items.find((i) => i.kind === 'phrase')).toMatchObject({ de: 'Wie geht es dir?', en: 'How are you?', notes: 'literally: how goes it to you' });
  });
  it('is words only: spoken lines are not used as examples or exercises', () => {
    if (!lesson.ok) return;
    // Before, every word carried its line as an example, so one line showed up once per word.
    expect(lesson.lesson.items.every((i) => !i.example)).toBe(true);
    expect(lesson.lesson.items.some((i) => i.kind === 'sentence')).toBe(false);
    expect(lesson.lesson.exercises).toHaveLength(0);
    expect(lesson.lesson.id).toBe('video-kRq3WzSwUw0');
  });
});
