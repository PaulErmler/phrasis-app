import { describe, expect, it } from 'vitest';
import {
  buildRenderingClassifierPrompt,
  buildRenderingClassifierUserPrompt,
  classificationLanguageForRow,
  parseRenderingClassifications,
  renderingAxesFor,
  reportedPolitenessLevels,
} from '../../../convex/lib/renderingClassifier';

describe('renderingAxesFor', () => {
  it('reports which axes a language can mark', () => {
    expect(renderingAxesFor('ja')).toEqual({ gender: true, politeness: true });
    expect(renderingAxesFor('tr')).toEqual({ gender: false, politeness: true });
    expect(renderingAxesFor('he')).toEqual({ gender: true, politeness: false });
    expect(renderingAxesFor('sv')).toEqual({
      gender: false,
      politeness: false,
    });
  });
});

describe('reportedPolitenessLevels', () => {
  it('reports each distinct form as its lowest level', () => {
    expect(reportedPolitenessLevels('tr')).toEqual(['casual', 'polite']);
    expect(reportedPolitenessLevels('fr')).toEqual(['casual', 'polite']);
    expect(reportedPolitenessLevels('ja')).toEqual([
      'casual',
      'polite',
      'formal',
    ]);
    expect(reportedPolitenessLevels('en')).toEqual([]);
  });
});

describe('buildRenderingClassifierPrompt', () => {
  it('names the language forms and examples', () => {
    const prompt = buildRenderingClassifierPrompt('ja');
    expect(prompt).toContain('です・ます');
    expect(prompt).toContain('行きます');
    expect(prompt).toContain('僕は学生です');
    expect(prompt).toContain('"polite"');
  });

  it('forces unmarked on an axis the language lacks', () => {
    const tr = buildRenderingClassifierPrompt('tr');
    expect(tr).toContain('"gender": always "unmarked"');
    expect(tr).toContain('siz');
    const he = buildRenderingClassifierPrompt('he');
    expect(he).toContain('"politeness": always "unmarked"');
  });

  it('has a literature wording arm', () => {
    const product = buildRenderingClassifierPrompt('ru', 'product');
    const literature = buildRenderingClassifierPrompt('ru', 'literature');
    expect(literature).toContain('speaker gender agreement');
    expect(product).not.toContain('speaker gender agreement');
  });

  it('numbers the sentences in the user prompt', () => {
    expect(buildRenderingClassifierUserPrompt(['a', 'b'])).toContain('2. b');
  });
});

describe('parseRenderingClassifications', () => {
  it('reads a well-formed array in order', () => {
    const raw = JSON.stringify([
      { i: 1, gender: 'feminine', politeness: 'polite' },
      { i: 2, gender: 'unmarked', politeness: 'casual' },
    ]);
    expect(parseRenderingClassifications('ja', raw, 2)).toEqual([
      { gender: 'feminine', politeness: 'polite' },
      { gender: 'unmarked', politeness: 'casual' },
    ]);
  });

  it('tolerates fences and falls back to array position', () => {
    const raw = '```json\n[{"gender":"masculine","politeness":"formal"}]\n```';
    expect(parseRenderingClassifications('he', raw, 1)).toEqual([
      { gender: 'masculine', politeness: 'unmarked' },
    ]);
  });

  it('forces axes the language cannot mark', () => {
    const raw = JSON.stringify([
      { i: 1, gender: 'feminine', politeness: 'polite' },
    ]);
    expect(parseRenderingClassifications('tr', raw, 1)).toEqual([
      { gender: 'unmarked', politeness: 'polite' },
    ]);
  });

  it('treats a politeness level the language never reports as unmarked', () => {
    // A two-form language reports casual and polite; a "formal" verdict
    // names no form of its own, so it must not be stamped as one.
    expect(reportedPolitenessLevels('tr')).toEqual(['casual', 'polite']);
    const raw = JSON.stringify([
      { i: 1, gender: 'unmarked', politeness: 'formal' },
      { i: 2, gender: 'unmarked', politeness: 'polite' },
    ]);
    expect(parseRenderingClassifications('tr', raw, 2)).toEqual([
      { gender: 'unmarked', politeness: 'unmarked' },
      { gender: 'unmarked', politeness: 'polite' },
    ]);
    // The gender verdict survives the rejected level.
    expect(
      parseRenderingClassifications(
        'fr',
        JSON.stringify([{ i: 1, gender: 'feminine', politeness: 'formal' }]),
        1,
      ),
    ).toEqual([{ gender: 'feminine', politeness: 'unmarked' }]);
  });

  it('leaves bad entries null instead of guessing', () => {
    const raw = JSON.stringify([
      { i: 1, gender: 'female', politeness: 'polite' },
      { i: 3, gender: 'masculine', politeness: 'polite' },
    ]);
    expect(parseRenderingClassifications('ja', raw, 2)).toEqual([null, null]);
    expect(parseRenderingClassifications('ja', 'not json', 2)).toEqual([
      null,
      null,
    ]);
  });
});

describe('classificationLanguageForRow', () => {
  it('resolves mixed dialects through the region variant', () => {
    expect(
      classificationLanguageForRow({
        targetLanguage: 'es_mixed',
        regionVariant: 'es-US',
      }),
    ).toBe('es_latam');
    expect(classificationLanguageForRow({ targetLanguage: 'es_mixed' })).toBe(
      'es',
    );
    expect(classificationLanguageForRow({ targetLanguage: 'de' })).toBe('de');
  });
});
