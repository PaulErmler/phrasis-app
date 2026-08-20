/// <reference types="vite/client" />
import { describe, it, expect } from 'vitest';
import {
  hasLocalRomanization,
  romanizeLocal,
  getRomanizationSource,
  ROMANIZATION_SOURCES,
} from '../../lib/localRomanization';

/**
 * Characterizes which languages romanize locally (in-process libraries) vs via
 * Google Cloud v3. Guards the "single source of truth" refactor that derives
 * this set from a `romanizationBackend` field on the Language record.
 */
describe('hasLocalRomanization', () => {
  const LOCAL = [
    'zh',
    'zh_traditional',
    'yue',
    'yue_traditional',
    'el',
    'ko',
    'he',
    'ar',
    'ar_sa',
    'ar_eg',
    'ar_iq',
    'ar_lev',
    'fa',
  ];
  // Romanized, but via Google Cloud v3 (not local).
  const GOOGLE_V3 = ['ru', 'hi', 'bn', 'ja'];
  // Not romanized at all.
  const NONE = ['en', 'de', 'fr', 'es', 'th'];

  it('returns true for every locally-romanized language', () => {
    for (const code of LOCAL) {
      expect(hasLocalRomanization(code), `code=${code}`).toBe(true);
    }
  });

  it('returns false for Google-v3 and non-romanized languages', () => {
    for (const code of [...GOOGLE_V3, ...NONE]) {
      expect(hasLocalRomanization(code), `code=${code}`).toBe(false);
    }
  });
});

describe('romanizeLocal: Chinese (zh / zh_traditional)', () => {
  it('routes both Chinese codes through chinese-to-pinyin', () => {
    expect(getRomanizationSource('zh')).toBe(
      ROMANIZATION_SOURCES.chineseToPinyin,
    );
    expect(getRomanizationSource('zh_traditional')).toBe(
      ROMANIZATION_SOURCES.chineseToPinyin,
    );
  });

  it('keeps punctuation, Latin runs and digits instead of deleting them', () => {
    // The bare `pinyin(text)` call defaulted to keepRest:false and silently
    // dropped every non-Han character.
    expect(romanizeLocal('你好，世界！', 'zh')).toBe('nǐ hǎo， shì jiè！');
    expect(romanizeLocal('我有2个苹果。', 'zh')).toBe('wǒ yǒu 2 gè píng guǒ。');
    expect(romanizeLocal('我今天很高兴，OK？3个人', 'zh')).toBe(
      'wǒ jīn tiān hěn gāo xìng，OK？3 gè rén',
    );
  });

  it('resolves traditional-script polyphones via the simplified segmenter', () => {
    // Without the traditional→simplified pre-conversion these read
    // yín xíng / shuì jué / hái qián / yīn lè.
    expect(romanizeLocal('我去銀行了。', 'zh_traditional')).toBe(
      'wǒ qù yín háng le。',
    );
    expect(romanizeLocal('我覺得睡覺很好。', 'zh_traditional')).toBe(
      'wǒ jué de shuì jiào hěn hǎo。',
    );
    expect(romanizeLocal('還沒還錢。', 'zh_traditional')).toBe(
      'hái méi huán qián。',
    );
    expect(romanizeLocal('音樂很快樂。', 'zh_traditional')).toBe(
      'yīn yuè hěn kuài lè。',
    );
  });

  it('produces the same pinyin for equivalent simplified and traditional text', () => {
    // Pinyin is script-independent, so the t2s pre-conversion must be lossless.
    expect(romanizeLocal('我去銀行了。', 'zh_traditional')).toBe(
      romanizeLocal('我去银行了。', 'zh'),
    );
  });
});

describe('romanizeLocal: Korean (ko)', () => {
  it('routes ko through es-hangul', () => {
    expect(getRomanizationSource('ko')).toBe(ROMANIZATION_SOURCES.esHangul);
  });

  it('applies Revised Romanization pronunciation rules, not letter mapping', () => {
    // hangul-romanization transliterated the spelling: hangukmal / gati /
    // sinra / johayo, misleading as a pronunciation guide.
    expect(romanizeLocal('한국말', 'ko')).toBe('hangungmal');
    expect(romanizeLocal('같이', 'ko')).toBe('gachi');
    expect(romanizeLocal('신라', 'ko')).toBe('silla');
    expect(romanizeLocal('좋아요', 'ko')).toBe('joayo');
  });

  it('passes punctuation, Latin runs and digits through', () => {
    expect(romanizeLocal('안녕하세요, OK? 3개', 'ko')).toBe(
      'annyeonghaseyo, OK? 3gae',
    );
  });
});

describe('romanizeLocal: Cantonese (yue / yue_traditional)', () => {
  it('routes both Cantonese codes through to-jyutping', () => {
    expect(getRomanizationSource('yue')).toBe(ROMANIZATION_SOURCES.toJyutping);
    expect(getRomanizationSource('yue_traditional')).toBe(
      ROMANIZATION_SOURCES.toJyutping,
    );
  });

  it('romanizes the vernacular particles instead of leaking raw characters', () => {
    // 嘅/㗎 mapped to empty strings (or were missing) in the retired
    // cantonese-romanisation dictionary and leaked through as characters.
    expect(romanizeLocal('「多謝」嘅日文係點講㗎？', 'yue_traditional')).toBe(
      '「 do1 ze6 」 ge3 jat6 man2 hai6 dim2 gong2 gaa3？',
    );
    expect(romanizeLocal('我哋係香港人', 'yue_traditional')).toBe(
      'ngo5 dei6 hai6 hoeng1 gong2 jan4',
    );
    expect(romanizeLocal('我唔知佢做乜嘢。', 'yue_traditional')).toBe(
      'ngo5 m4 zi1 keoi5 zou6 mat1 je5。',
    );
  });

  it('picks in-context readings for polyphonic characters', () => {
    // First-candidate selection used to yield hak1 (可), heoi2 (去), ji6 (食).
    expect(romanizeLocal('你可以帶我去嗎？', 'yue_traditional')).toContain(
      'ho2 ji5',
    );
    expect(romanizeLocal('你可以帶我去嗎？', 'yue_traditional')).toContain(
      'heoi3',
    );
    expect(romanizeLocal('食咗飯未呀？', 'yue_traditional')).toContain('sik6');
  });

  it('covers simplified-script Cantonese', () => {
    expect(romanizeLocal('食咗饭未呀？', 'yue')).toContain('sik6 zo2 faan6');
    expect(romanizeLocal('「多谢」嘅日文系点讲㗎？', 'yue')).toContain(
      'do1 ze6',
    );
  });

  it('handles surrogate-pair characters without desyncing readings', () => {
    // 𡃁 is outside the BMP; the retired library split by UTF-16 code units
    // and misaligned every reading after it.
    expect(romanizeLocal('我𡃁仔好好', 'yue_traditional')).toBe(
      'ngo5 leng1 zai2 hou2 hou2',
    );
  });

  it('passes Latin runs and digits through verbatim', () => {
    expect(romanizeLocal('OK 3個人', 'yue_traditional')).toBe('OK 3 go3 jan4');
  });

  it('keeps fullwidth punctuation glued to the preceding syllable', () => {
    expect(romanizeLocal('你好，世界！', 'yue_traditional')).toBe(
      'nei5 hou2， sai3 gaai3！',
    );
  });
});

describe('romanizeLocal: Persian (fa)', () => {
  it('routes fa through @sindresorhus/transliterate', () => {
    expect(getRomanizationSource('fa')).toBe(
      ROMANIZATION_SOURCES.sindresorhusTransliterate,
    );
  });

  it('transliterates the Perso-Arabic consonant skeleton', () => {
    // Short vowels are not written in the script, so they're absent (slam, not salam).
    expect(romanizeLocal('سلام', 'fa')).toBe('slam');
    expect(romanizeLocal('فارسی', 'fa')).toBe('farsy');
  });

  it('strips the zero-width non-joiner (U+200C) between word parts', () => {
    expect(romanizeLocal('می‌روم', 'fa')).toBe('myrwm');
    expect(romanizeLocal('می‌روم', 'fa')).not.toMatch(/‌/);
  });

  it('leaves no non-ASCII residue (ezafe hamza U+0654 / superscript alef U+0670)', () => {
    // The ezafe hamza on -e/-eh words is common; it (and superscript alef) must
    // not leak into the learner-facing romanization.
    expect(romanizeLocal('خانهٔ من', 'fa')).not.toMatch(/[\u0080-\uFFFF]/);
    expect(romanizeLocal('رحمٰن', 'fa')).not.toMatch(/[\u0080-\uFFFF]/);
  });
});
