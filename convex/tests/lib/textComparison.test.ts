import { describe, it, expect } from 'vitest';
import { soundsSame } from '../../lib/textComparison';

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
