import { describe, expect, it } from 'vitest';
import { gradeOrder, gradeText, gradeVocab, levenshtein } from '../src/core/grading';

describe('gradeText', () => {
  it('accepts exact answers ignoring punctuation and spacing', () => {
    expect(gradeText('  Ich hätte  gern ein Brot! ', ['Ich hätte gern ein Brot.']).verdict).toBe('correct');
  });
  it('accepts ae/oe/ue/ss for umlauts and ß', () => {
    expect(gradeText('Ich haette gern Kaese', ['Ich hätte gern Käse']).verdict).toBe('correct');
    expect(gradeText('Strasse', ['Straße']).verdict).toBe('correct');
  });
  it('is case-insensitive by default and "almost" with strictCaps', () => {
    expect(gradeText('brot', ['Brot']).verdict).toBe('correct');
    expect(gradeText('brot', ['Brot'], { strictCaps: true })).toMatchObject({ verdict: 'almost', note: 'caps' });
  });
  it('flags a small typo as almost but not a short wrong word', () => {
    expect(gradeText('Bäkerei', ['Bäckerei'])).toMatchObject({ verdict: 'almost', note: 'typo' });
    expect(gradeText('Bot', ['Brot']).verdict).toBe('almost'); // 4+ letters tolerate one typo
    expect(gradeText('Tea', ['Tee']).verdict).toBe('wrong'); // under 4 letters: no tolerance
    //  letters: 1 edit allowed -> almost
  });
  it('picks the closest accepted answer for feedback', () => {
    const r = gradeText('Ich bestelle Brot weil ich Hunger habe', ['Weil ich Hunger habe, bestelle ich Brot.', 'Ich bestelle Brot, weil ich Hunger habe.']);
    expect(r.verdict).toBe('correct');
    expect(r.expected).toBe('Ich bestelle Brot, weil ich Hunger habe.');
  });
  it('marks empty and unrelated input wrong', () => {
    expect(gradeText('', ['Brot']).verdict).toBe('wrong');
    expect(gradeText('Katze', ['Brot']).verdict).toBe('wrong');
  });
});

describe('gradeVocab', () => {
  const brot = { de: 'Brot', article: 'das' };
  it('requires the article for nouns', () => {
    expect(gradeVocab('das Brot', brot).verdict).toBe('correct');
    expect(gradeVocab('Brot', brot)).toMatchObject({ verdict: 'almost', note: 'article', expected: 'das Brot' });
    expect(gradeVocab('der Brot', brot).verdict).toBe('wrong');
  });
  it('works without article', () => {
    expect(gradeVocab('bestellen', { de: 'bestellen' }).verdict).toBe('correct');
  });
  it('ignores the trailing ellipsis in phrases', () => {
    expect(gradeVocab('Ich hätte gern', { de: 'Ich hätte gern …' }).verdict).toBe('correct');
  });
});

describe('gradeOrder', () => {
  it('accepts any listed order and rejects others', () => {
    const answers = ['Weil ich Hunger habe, bestelle ich Brot.', 'Ich bestelle Brot, weil ich Hunger habe.'];
    expect(gradeOrder(['Ich', 'bestelle', 'Brot,', 'weil', 'ich', 'Hunger', 'habe.'], answers).verdict).toBe('correct');
    expect(gradeOrder(['Ich', 'Brot,', 'bestelle', 'weil', 'ich', 'Hunger', 'habe.'], answers).verdict).toBe('wrong');
  });
});

describe('levenshtein', () => {
  it('computes edit distance', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});
