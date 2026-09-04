import { describe, it, expect } from 'vitest';

import {
  normalizeTranscriptScript,
  resolveScriptTarget,
  scriptConverterFor,
} from '../../../lib/stt/scriptNormalize';

describe('lib/stt/scriptNormalize', () => {
  describe('normalizeTranscriptScript', () => {
    it('converts Latin Serbian to Cyrillic, words included', () => {
      const result = normalizeTranscriptScript(
        {
          text: 'Danas je lep dan.',
          wordTimings: [
            { word: 'Danas', start: 0, end: 0.3 },
            { word: 'šetnju.', start: 1, end: 1.5 },
          ],
          costUsd: 0.00001,
        },
        'sr',
      );
      expect(result.text).toBe('Данас је леп дан.');
      expect(result.wordTimings).toEqual([
        { word: 'Данас', start: 0, end: 0.3 },
        { word: 'шетњу.', start: 1, end: 1.5 },
      ]);
      // Everything else on the result passes through untouched.
      expect(result.costUsd).toBe(0.00001);
    });

    it('converts Simplified to Traditional for zh_traditional', () => {
      const result = normalizeTranscriptScript(
        {
          text: '这个电话很贵。',
          wordTimings: [{ word: '电', start: 0, end: 0.2 }],
        },
        'zh_traditional',
      );
      expect(result.text).toBe('這個電話很貴。');
      expect(result.wordTimings[0].word).toBe('電');
    });

    it('converts Traditional Cantonese to Simplified for yue', () => {
      const result = normalizeTranscriptScript(
        { text: '你喺邊度？', wordTimings: [] },
        'yue',
      );
      expect(result.text).toBe('你喺边度？');
    });

    it('leaves Traditional Cantonese alone for yue_traditional', () => {
      const text = '今日天氣好好，我哋去公園行下啦。';
      expect(
        normalizeTranscriptScript({ text, wordTimings: [] }, 'yue_traditional')
          .text,
      ).toBe(text);
    });

    it('is the identity for languages the model already writes correctly', () => {
      const input = {
        text: 'Guten Morgen',
        wordTimings: [{ word: 'Guten', start: 0, end: 0.3 }],
      };
      expect(normalizeTranscriptScript(input, 'de')).toBe(input);
      expect(normalizeTranscriptScript(input, 'zh')).toBe(input);
      expect(normalizeTranscriptScript(input, undefined)).toBe(input);
    });
  });

  describe('scriptConverterFor', () => {
    it('has a converter only where the model writes the wrong script', () => {
      for (const code of ['sr', 'zh_traditional', 'yue']) {
        expect(scriptConverterFor(code)).not.toBeNull();
      }
      // yue_traditional: the model already writes Traditional Cantonese, and
      // cn→hk over Traditional text would rewrite 后/干/里/只.
      for (const code of ['yue_traditional', 'en', 'zh', 'ru', 'ja', 'hr']) {
        expect(scriptConverterFor(code)).toBeNull();
      }
    });
  });

  describe('resolveScriptTarget', () => {
    it('always maps detected Serbian to sr', () => {
      expect(resolveScriptTarget('sr', [])).toBe('sr');
      expect(resolveScriptTarget('sr', ['en', 'hr'])).toBe('sr');
    });

    it('resolves Mandarin and Cantonese by the single course member of the pair', () => {
      expect(resolveScriptTarget('zh', ['en', 'zh_traditional'])).toBe(
        'zh_traditional',
      );
      expect(resolveScriptTarget('zh', ['en', 'zh'])).toBe('zh');
      expect(resolveScriptTarget('yue', ['en', 'yue'])).toBe('yue');
      expect(resolveScriptTarget('yue', ['yue_traditional'])).toBe(
        'yue_traditional',
      );
    });

    it('gives up when the course names both members or neither', () => {
      expect(
        resolveScriptTarget('zh', ['zh', 'zh_traditional']),
      ).toBeUndefined();
      expect(resolveScriptTarget('zh', ['en', 'de'])).toBeUndefined();
      expect(resolveScriptTarget('yue', ['zh_traditional'])).toBeUndefined();
    });

    it('ignores other languages and a missing detection', () => {
      expect(resolveScriptTarget('de', ['de'])).toBeUndefined();
      expect(resolveScriptTarget(undefined, ['sr'])).toBeUndefined();
    });
  });
});
