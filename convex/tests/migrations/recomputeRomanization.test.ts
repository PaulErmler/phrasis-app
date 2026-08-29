import { describe, it, expect } from 'vitest';
import { recomputeRomanizationPatch } from '../../migrations';
import { ROMANIZATION_SOURCES } from '../../lib/localRomanization';

describe('recomputeRomanizationPatch (migrateOne logic)', () => {
  it('rewrites Chinese rows whose romanization dropped punctuation and digits', () => {
    expect(
      recomputeRomanizationPatch('zh', '我有2个苹果。', 'wǒ yǒu gè píng guǒ'),
    ).toEqual({
      romanizedText: 'wǒ yǒu 2 gè píng guǒ。',
      romanizationSource: ROMANIZATION_SOURCES.chineseToPinyin,
    });
  });

  it('rewrites traditional-script rows that got context-blind polyphone readings', () => {
    expect(
      recomputeRomanizationPatch(
        'zh_traditional',
        '我去銀行了。',
        'wǒ qù yín xíng le',
      ),
    ).toEqual({
      romanizedText: 'wǒ qù yín háng le。',
      romanizationSource: ROMANIZATION_SOURCES.chineseToPinyin,
    });
  });

  it('rewrites Korean rows romanized from spelling rather than pronunciation', () => {
    expect(recomputeRomanizationPatch('ko', '한국말', 'hangukmal')).toEqual({
      romanizedText: 'hangungmal',
      romanizationSource: ROMANIZATION_SOURCES.esHangul,
    });
  });

  it('returns undefined when the value is already current, idempotent re-run', () => {
    expect(
      recomputeRomanizationPatch('ko', '한국말', 'hangungmal'),
    ).toBeUndefined();
    expect(recomputeRomanizationPatch('zh', '你好', 'nǐ hǎo')).toBeUndefined();
  });

  it('leaves languages outside the affected set untouched', () => {
    // Cantonese is handled by the separate reset migration; the rest were
    // audited clean and must not be rewritten here.
    expect(
      recomputeRomanizationPatch('yue_traditional', '我唔知。', 'anything'),
    ).toBeUndefined();
    expect(
      recomputeRomanizationPatch('el', 'Καλημέρα', 'stale'),
    ).toBeUndefined();
    expect(recomputeRomanizationPatch('ar', 'سلام', 'stale')).toBeUndefined();
  });

  it('respects the romanizedText tri-state, never resurrects undefined or the failed sentinel', () => {
    // undefined = never attempted (the scheduler owns it); '' = attempted and
    // failed, a sentinel this migration has no new information about.
    expect(recomputeRomanizationPatch('zh', '你好', undefined)).toBeUndefined();
    expect(recomputeRomanizationPatch('zh', '你好', '')).toBeUndefined();
  });

  it('never overwrites good data with an empty romanization', () => {
    // A source text with no romanizable characters must not blank the row.
    expect(recomputeRomanizationPatch('zh', '', 'wǒ hǎo')).toBeUndefined();
  });
});
