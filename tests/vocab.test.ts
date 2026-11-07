import { describe, expect, it } from 'vitest';
import { buildLexicon, tokenize, uncoveredWords, wordsIn, type LexItem } from '../src/core/vocab';
import { importLessonText } from '../src/core/importer';

const items: LexItem[] = [
  { id: 'brot', kind: 'noun', de: 'Brot', en: 'bread', article: 'das', plural: 'Brote' },
  { id: 'bestellen', kind: 'verb', de: 'bestellen', en: 'to order', forms: { er: 'bestellt', perfekt: 'hat bestellt' } },
  { id: 'aufstehen', kind: 'verb', de: 'aufstehen', en: 'to get up', forms: { er: 'steht auf' } },
  { id: 'essen', kind: 'verb', de: 'essen', en: 'to eat', forms: { er: 'isst' } },
  { id: 'gross', kind: 'adjective', de: 'groß', en: 'big' },
];
const lex = buildLexicon(items);

describe('lexicon', () => {
  it('tokenizes German text', () => {
    expect(tokenize('Ich hätte gern ein Brot, bitte.')).toEqual(['Ich', 'hätte', 'gern', 'ein', 'Brot', 'bitte']);
  });
  it('finds inflected forms', () => {
    expect(lex.lookup('Brote')?.id).toBe('brot');
    expect(lex.lookup('bestelle')?.id).toBe('bestellen');
    expect(lex.lookup('bestellst')?.id).toBe('bestellen');
    expect(lex.lookup('bestellt')?.id).toBe('bestellen');
    expect(lex.lookup('gebestellt')?.id).toBe('bestellen');
    expect(lex.lookup('isst')?.id).toBe('essen'); // from forms
    expect(lex.lookup('große')?.id).toBe('gross');
    expect(lex.lookup('steht')?.id).toBe('aufstehen');
  });
  it('returns nothing for unknown words', () => {
    expect(lex.lookup('Katze')).toBeUndefined();
  });
  it('lists covered words in a sentence', () => {
    expect(wordsIn(['Ich bestelle ein Brot und Brote'], lex).map((i) => i.id)).toEqual(['bestellen', 'brot']);
  });
});

describe('uncoveredWords', () => {
  it('ignores basic words and covered vocabulary', () => {
    expect(uncoveredWords(['Ich bestelle gern ein Brot und eine Suppe.'], lex)).toEqual(['Suppe']);
  });
});

describe('import coverage warning', () => {
  it('warns about content words in sentences that have no item', () => {
    const r = importLessonText(
      `id: t
title: T
items:
  - { kind: noun, de: Brot, article: das, en: bread, example: { de: "Ich esse Brot mit Butter.", en: x } }
exercises:
  - { type: translate, prompt: p, answers: ["Ich bestelle Käse."] }
`,
      't.yaml',
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.join('\n')).toMatch(/esse, Butter, bestelle, Käse/);
  });
  it('does not warn when everything is covered', () => {
    const r = importLessonText(
      `id: t
title: T
items:
  - { kind: noun, de: Brot, article: das, en: bread, example: { de: "Ich esse Brot.", en: x } }
  - { kind: verb, de: essen, en: to eat }
`,
      't.yaml',
    );
    expect(r.ok && r.warnings.length).toBe(0);
  });
});
