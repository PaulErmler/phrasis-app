import { describe, it, expect } from 'vitest';
import { soundsSame, textsMatchForLanguage } from '../../lib/textComparison';

describe('soundsSame', () => {
  it('treats inaudible punctuation-only differences as identical', () => {
    expect(soundsSame('Hola.', 'Hola!')).toBe(true);
    expect(soundsSame('Hola', 'Hola.')).toBe(true);
    expect(soundsSame('Hej', 'Hej!')).toBe(true);
    expect(soundsSame('Oh, ich bin', 'Oh ich bin')).toBe(true);
  });

  it("treats trailing '_' as inaudible (underscore is \\p{P})", () => {
    expect(soundsSame('أوه، أنا متأسفة._', 'أوه، أنا متأسفة.')).toBe(true);
    expect(soundsSame('Hola._', 'Hola.')).toBe(true);
  });

  it('handles Arabic separators (،)', () => {
    expect(soundsSame('أوه، أنا', 'أوه أنا')).toBe(true);
  });

  it('question marks are audible — intonation changes', () => {
    expect(soundsSame('Estás bien.', '¿Estás bien?')).toBe(false);
    expect(soundsSame('You are coming.', 'You are coming?')).toBe(false);
    expect(soundsSame('هل تتكلم العربية؟', 'هل تتكلم العربية')).toBe(false);
    // Question mark on both sides, only inaudible marks differ → same.
    expect(soundsSame('¿Cómo estás?', 'Cómo estás?')).toBe(true);
  });

  it('Greek question marks are audible (both U+037E and NFC-folded U+003B)', () => {
    // NFC maps U+037E GREEK QUESTION MARK to ';' (U+003B); both forms must
    // flip the verdict, which is why ';' is not in the inaudible set.
    expect(soundsSame('Είσαι καλά.', 'Είσαι καλά;')).toBe(false);
    expect(soundsSame('Είσαι καλά.', 'Είσαι καλά;')).toBe(false);
    expect(soundsSame('Είσαι καλά;', 'Είσαι καλά;')).toBe(true);
  });

  it("pronounced \\p{Po} characters ('%', '&', '#', '@') are audible", () => {
    expect(soundsSame('Es sind 50%', 'Es sind 50')).toBe(false);
    expect(soundsSame('Tom & Jerry', 'Tom Jerry')).toBe(false);
    expect(soundsSame('Gate #3', 'Gate 3')).toBe(false);
    expect(soundsSame('mail@host', 'mail host')).toBe(false);
  });

  it('semicolon counts as audible — the documented cheap-and-safe trade-off', () => {
    // An English 'a; b' → 'a b' edit is spoken the same but still counts as
    // different (unneeded regeneration); the price of Greek questions
    // (';' after NFC) staying audible.
    expect(soundsSame('Komm her; jetzt', 'Komm her jetzt')).toBe(false);
  });

  it('punctuation between digits is audible — the number changes', () => {
    expect(soundsSame('I ran 3.5 miles', 'I ran 35 miles')).toBe(false);
    expect(soundsSame('Es ist 1:30', 'Es ist 130')).toBe(false);
    // Trade-off documented on soundsSame: '1,000' → '1000' is spoken the
    // same but still counts as different (unneeded-but-cheap regeneration).
    expect(soundsSame('1,000', '1000')).toBe(false);
  });

  it('collapses whitespace runs', () => {
    expect(soundsSame('Hola  mundo', 'Hola mundo')).toBe(true);
  });

  it('word changes are audible', () => {
    expect(soundsSame('Hola', 'Adiós')).toBe(false);
    expect(soundsSame('Sie ist dort drüben', 'Sie ist dadrüben')).toBe(false);
  });

  it('keeps case (narrower than normalizeForComparison)', () => {
    expect(soundsSame('hola', 'Hola')).toBe(false);
  });

  it('keeps symbols — "€" is pronounced', () => {
    expect(soundsSame('5 €', '5')).toBe(false);
  });
});

/**
 * TTS validation romanizes both sides for zh / zh_traditional / ko before
 * comparing, so Scribe returning a homophone character still matches. These
 * guard that path against romanizer changes — notably the switch to
 * segment-based pinyin (which stopped deleting punctuation and digits) and to
 * pronunciation-based Korean romanization.
 */
describe('textsMatchForLanguage', () => {
  it('accepts a hanzi homophone swap that romanizes identically', () => {
    // 在 vs 再 — the whole reason this comparison romanizes first.
    expect(textsMatchForLanguage('我在这里', '我再这里', 'zh')).toBe(true);
  });

  it('still rejects a genuinely different Chinese sentence', () => {
    expect(textsMatchForLanguage('我有三个苹果', '他喜欢喝茶', 'zh')).toBe(false);
  });

  it('ignores punctuation differences even though romanization now keeps them', () => {
    // normalizeForComparison strips \p{P}\p{S}, so restoring punctuation in the
    // romanizer must not make STT output (typically unpunctuated) stop matching.
    expect(textsMatchForLanguage('你好，世界！', '你好世界', 'zh')).toBe(true);
  });

  it('matches numerals against themselves now that digits survive romanization', () => {
    // Digits are NOT stripped by normalizeForComparison, so they reach the
    // comparison for the first time. Identical text must still match.
    expect(textsMatchForLanguage('我有2个苹果。', '我有2个苹果', 'zh')).toBe(true);
  });

  it('matches equivalent traditional text after the simplified pre-conversion', () => {
    expect(
      textsMatchForLanguage('我去銀行了。', '我去銀行了', 'zh_traditional'),
    ).toBe(true);
  });

  it('matches Korean against itself under pronunciation-based romanization', () => {
    expect(textsMatchForLanguage('한국말', '한국말', 'ko')).toBe(true);
  });

  it('accepts a Korean spelling difference that sounds identical', () => {
    // 신라 and 실라 are spelled differently but both pronounced "silla" —
    // exactly the case pronunciation-based romanization is meant to absorb.
    expect(textsMatchForLanguage('신라', '실라', 'ko')).toBe(true);
  });

  it('falls back to character comparison for languages with no local romanizer', () => {
    expect(textsMatchForLanguage('Hola', 'Hola', 'es')).toBe(true);
    expect(textsMatchForLanguage('Hola', 'Adiós', 'es')).toBe(false);
  });
});
