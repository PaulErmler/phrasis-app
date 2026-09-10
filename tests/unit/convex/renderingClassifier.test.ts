import { describe, expect, it } from 'vitest';
import {
  buildRenderingClassifierPrompt,
  buildRenderingClassifierUserPrompt,
  parseRenderingClassifications,
  renderingAxesFor,
} from '../../../convex/lib/renderingClassifier';

describe('renderingAxesFor', () => {
  it('marks the languages whose wording follows the speaker', () => {
    expect(renderingAxesFor('ja')).toEqual({ gender: true });
    expect(renderingAxesFor('tr')).toEqual({ gender: false });
    expect(renderingAxesFor('he')).toEqual({ gender: true });
    expect(renderingAxesFor('en')).toEqual({ gender: false });
  });
});

describe('buildRenderingClassifierPrompt', () => {
  it('names the language example pair', () => {
    const prompt = buildRenderingClassifierPrompt('ja');
    expect(prompt).toContain('"gender"');
    expect(prompt).toContain('masculine');
  });

  it('forces unmarked on a language that does not mark the speaker', () => {
    expect(buildRenderingClassifierPrompt('tr')).toContain(
      '"gender": always "unmarked"',
    );
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
      { i: 1, gender: 'feminine' },
      { i: 2, gender: 'unmarked' },
    ]);
    expect(parseRenderingClassifications('ja', raw, 2)).toEqual([
      { gender: 'feminine' },
      { gender: 'unmarked' },
    ]);
  });

  it('tolerates fences and falls back to array position', () => {
    const raw = '```json\n[{"gender":"masculine"}]\n```';
    expect(parseRenderingClassifications('he', raw, 1)).toEqual([
      { gender: 'masculine' },
    ]);
  });

  it('forces unmarked on a language that cannot mark the speaker', () => {
    const raw = JSON.stringify([{ i: 1, gender: 'feminine' }]);
    expect(parseRenderingClassifications('tr', raw, 1)).toEqual([
      { gender: 'unmarked' },
    ]);
  });

  it('degrades a bad reply to "not classified" for that row', () => {
    expect(parseRenderingClassifications('ja', 'not json', 2)).toEqual([
      null,
      null,
    ]);
    expect(
      parseRenderingClassifications('ja', JSON.stringify([{ i: 1 }]), 1),
    ).toEqual([null]);
  });
});
