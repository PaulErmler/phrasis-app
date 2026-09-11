import { describe, expect, it } from 'vitest';
import { alignAnnotations, canAlign, sentenceWords } from '@/lib/wordAlignment';

/**
 * Alignment is recovered from strings, so the rule that matters is when it
 * REFUSES. A mapping that pairs the wrong words is worse than no mapping,
 * because nothing on screen tells the reader it is wrong.
 */

describe('sentenceWords', () => {
  it('splits a spaced language on whitespace, punctuation attached', () => {
    expect(sentenceWords('Мне нравится гулять.', 'ru')).toEqual([
      'Мне',
      'нравится',
      'гулять.',
    ]);
  });

  it('segments a language written without spaces', () => {
    const words = sentenceWords('私は本を読みます。', 'ja');
    expect(words.length).toBeGreaterThan(1);
    expect(words.join('')).toBe('私は本を読みます。');
  });

  it('is empty for empty text', () => {
    expect(sentenceWords('   ', 'ru')).toEqual([]);
  });
});

describe('alignAnnotations', () => {
  const base = { text: 'Мне нравится гулять', language: 'ru' };

  it('pairs each word with its unit', () => {
    const aligned = alignAnnotations({
      ...base,
      hyperliteral: 'To-me pleases to-walk',
    });
    expect(aligned).toEqual([
      { source: 'Мне', hyperliteral: 'To-me' },
      { source: 'нравится', hyperliteral: 'pleases' },
      { source: 'гулять', hyperliteral: 'to-walk' },
    ]);
  });

  it('pairs several aids at once', () => {
    const aligned = alignAnnotations({
      ...base,
      hyperliteral: 'To-me pleases to-walk',
      romanization: 'mne nravitsya gulyat',
    });
    expect(aligned?.[0]).toEqual({
      source: 'Мне',
      hyperliteral: 'To-me',
      romanization: 'mne',
    });
  });

  it('drops only the aid whose unit count disagrees', () => {
    const aligned = alignAnnotations({
      ...base,
      hyperliteral: 'To-me pleases to-walk',
      // Four units against three words: this one cannot be trusted.
      romanization: 'mne nra vitsya gulyat',
    });
    expect(aligned?.[0]).toEqual({ source: 'Мне', hyperliteral: 'To-me' });
    expect(aligned?.every((w) => w.romanization === undefined)).toBe(true);
  });

  it('is null when no aid aligns, so no control is offered', () => {
    expect(
      alignAnnotations({ ...base, hyperliteral: 'To-me pleases' }),
    ).toBeNull();
  });

  it('is null when there is nothing to align', () => {
    expect(alignAnnotations(base)).toBeNull();
  });

  it('ignores the empty-string failure sentinel', () => {
    expect(alignAnnotations({ ...base, hyperliteral: '' })).toBeNull();
  });

  it('aligns a spaceless language when the segmenter agrees with the model', () => {
    const text = '私は本を読みます';
    const words = sentenceWords(text, 'ja');
    const aligned = alignAnnotations({
      text,
      language: 'ja',
      hyperliteral: words.map((_, i) => `g${i}`).join(' '),
    });
    expect(aligned).toHaveLength(words.length);
  });

  it('refuses a spaceless language when the segmentations differ', () => {
    // The model split this sentence into three units; the segmenter does not
    // agree, and guessing which word each gloss belongs to is exactly the
    // mistake this refuses to make.
    expect(
      alignAnnotations({
        text: '私は本を読みます',
        language: 'ja',
        hyperliteral: 'I [topic] read',
      }),
    ).toBeNull();
  });
});

describe('canAlign', () => {
  it('answers the same question as alignAnnotations', () => {
    const input = {
      text: 'Мне нравится',
      language: 'ru',
      hyperliteral: 'To-me pleases',
    };
    expect(canAlign(input)).toBe(true);
    expect(canAlign({ ...input, hyperliteral: 'To-me' })).toBe(false);
  });
});
