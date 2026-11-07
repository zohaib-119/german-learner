import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { importLessonText, slugify } from '../src/core/importer';
import { parseCsv } from '../src/core/importer/csv';

const sample = (f: string) => readFileSync(new URL(`../sample-lessons/${f}`, import.meta.url), 'utf8');

describe('slugify', () => {
  it('transliterates German characters', () => {
    expect(slugify('Käse & Brötchen')).toBe('kaese-broetchen');
    expect(slugify('Straße')).toBe('strasse');
  });
});

describe('parseCsv', () => {
  it('handles quotes, embedded commas, CRLF and semicolons', () => {
    expect(parseCsv('a,b\r\n"x, y","he said ""hi"""\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"'],
    ]);
    expect(parseCsv('de;en\nBrot;bread')).toEqual([
      ['de', 'en'],
      ['Brot', 'bread'],
    ]);
  });
});

describe('importLessonText (YAML)', () => {
  it('imports the sample lesson with derived ids', () => {
    const r = importLessonText(sample('bakery-vocab.yaml'), 'bakery-vocab.yaml');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lesson.items).toHaveLength(10);
    expect(r.warnings).toEqual([]); // every word used in sentences is also an item
    expect(r.lesson.items.map((i) => i.id)).toContain('broetchen');
    expect(r.lesson.exercises).toHaveLength(6);
    expect(new Set(r.lesson.exercises.map((e) => e.id)).size).toBe(6);
    expect(r.lesson.items.every((i) => i.kind === 'sentence' || i.example)).toBe(true); // every word has an example
  });

  it('reports YAML syntax errors', () => {
    const r = importLessonText('id: x\n title: [oops', 'bad.yaml');
    expect(r.ok).toBe(false);
  });

  it('reports schema errors with path and line', () => {
    const text = `id: t
title: T
items:
  - de: Hund
    en: dog
    article: den
`;
    const r = importLessonText(text, 't.yaml');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors[0]).toMatch(/items\[0\]\.article/);
    expect(r.errors[0]).toMatch(/line 6/);
  });

  it('rejects an unknown exercise type', () => {
    const r = importLessonText(`id: t\ntitle: T\nexercises:\n  - type: bogus\n`, 't.yaml');
    expect(r.ok).toBe(false);
  });

  it('requires ___ in fill_blank and valid multiple_choice index', () => {
    const r = importLessonText(
      `id: t
title: T
exercises:
  - { type: fill_blank, prompt: "no blank", answer: x }
  - { type: multiple_choice, prompt: p, options: [a, b], correct: 5 }
`,
      't.yaml',
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.length).toBe(2);
  });

  it('rejects duplicate item ids but accepts an explicit id', () => {
    const dup = `id: t\ntitle: T\nitems:\n  - { de: Bank, en: bench }\n  - { de: Bank, en: bank }\n`;
    expect(importLessonText(dup, 't.yaml').ok).toBe(false);
    const fixed = `id: t\ntitle: T\nitems:\n  - { de: Bank, en: bench }\n  - { id: bank-money, de: Bank, en: bank }\n`;
    expect(importLessonText(fixed, 't.yaml').ok).toBe(true);
  });

  it('warns when word_order answer does not match tokens', () => {
    const r = importLessonText(
      `id: t\ntitle: T\nexercises:\n  - { type: word_order, tokens: [Ich, bin, hier], answers: ["Ich bin da"] }\n`,
      't.yaml',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.length).toBe(1);
  });

  it('keeps exercise ids stable when exercises are reordered', () => {
    const a = `id: t\ntitle: T\nexercises:\n  - { type: translate, prompt: A, answers: [a] }\n  - { type: translate, prompt: B, answers: [b] }\n`;
    const b = `id: t\ntitle: T\nexercises:\n  - { type: translate, prompt: B, answers: [b] }\n  - { type: translate, prompt: A, answers: [a] }\n`;
    const ra = importLessonText(a, 't.yaml');
    const rb = importLessonText(b, 't.yaml');
    if (!ra.ok || !rb.ok) throw new Error('should import');
    expect(new Set(ra.lesson.exercises.map((e) => e.id))).toEqual(new Set(rb.lesson.exercises.map((e) => e.id)));
  });

  it('rejects a newer schema_version', () => {
    expect(importLessonText('schema_version: 99\nid: t\ntitle: T\n', 't.yaml').ok).toBe(false);
  });
});

describe('listen_choose', () => {
  const base = `id: t\ntitle: T\nitems:\n  - { kind: noun, de: Brot, article: das, en: bread }\n`;
  it('imports and checks only the audio text for missing words', () => {
    const r = importLessonText(`${base}exercises:\n  - { type: listen_choose, audio: "Ich esse Brot.", options: [I eat bread., I drink water.], correct: 0 }\n`, 't.yaml');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.lesson.exercises[0]!.id).toMatch(/^listen_choose-/);
      expect(r.warnings.join()).toMatch(/esse/); // the German audio uses a word that is not an item
      expect(r.warnings.join()).not.toMatch(/drink|water/); // English options are not checked
    }
  });
  it('rejects a bad correct index and a missing audio field', () => {
    expect(importLessonText(`${base}exercises:\n  - { type: listen_choose, audio: Hallo, options: [a, b], correct: 3 }\n`, 't.yaml').ok).toBe(false);
    expect(importLessonText(`${base}exercises:\n  - { type: listen_choose, options: [a, b], correct: 0 }\n`, 't.yaml').ok).toBe(false);
  });
});

describe('importLessonText (CSV)', () => {
  it('imports the sample CSV as a vocab lesson', () => {
    const r = importLessonText(sample('everyday-expressions.csv'), 'everyday-expressions.csv');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lesson.id).toBe('everyday-expressions');
    expect(r.lesson.items).toHaveLength(3);
    expect(r.lesson.items[0]?.example?.de).toMatch(/Bahnhof/);
  });

  it('requires de and en columns', () => {
    expect(importLessonText('de,x\nBrot,y', 'a.csv').ok).toBe(false);
  });

  it('reports row numbers for bad rows', () => {
    const r = importLessonText('de,en,article\nHund,dog,den', 'a.csv');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toMatch(/row 2/);
  });
});

describe('unsupported files', () => {
  it('rejects unknown extensions', () => {
    expect(importLessonText('x', 'a.txt').ok).toBe(false);
  });
});
