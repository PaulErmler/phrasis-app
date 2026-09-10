import { describe, expect, it } from 'vitest';
import { supportedAnnotationEntries } from '../../lib/textAnnotations';

/**
 * Dropping a language's `ipaVoice` stops the card projection serving its
 * stored IPA (lib/cardContent.ts), but two surfaces read a language-keyed
 * record instead of a per-language row and were serving it ungated:
 * `cardApprovals.entryIpa` and `entryFurigana`. An approval proposed before
 * the Sep 2026 removals still holds a Thai key, so without this filter the
 * chat card would keep rendering the transcription the removal retired.
 */

describe('supportedAnnotationEntries', () => {
  it('keeps entries for languages the kind still supports', () => {
    expect(
      supportedAnnotationEntries('ipa', { de: 'hˈaloː', fr: 'bɔ̃ʒˈuʁ' }),
    ).toEqual({ de: 'hˈaloː', fr: 'bɔ̃ʒˈuʁ' });
  });

  it('drops entries for languages that lost their espeak voice', () => {
    expect(
      supportedAnnotationEntries('ipa', {
        de: 'hˈaloː',
        th: 'sˈa5wmsaɜds',
        he: 'todˈa rvh',
        zh: 'mˈɑ5',
      }),
    ).toEqual({ de: 'hˈaloː' });
  });

  it('keeps the failure sentinel for a supported language', () => {
    // '' means "attempted and failed", which the UI already filters on
    // truthiness. Dropping it here would be a different claim than the
    // per-language projection makes.
    expect(supportedAnnotationEntries('ipa', { de: '' })).toEqual({ de: '' });
  });

  it('gates furigana on the furigana language set, not the IPA one', () => {
    expect(
      supportedAnnotationEntries('furigana', { ja: '毎朝[まいあさ]', de: 'x' }),
    ).toEqual({ ja: '毎朝[まいあさ]' });
    // ja has no ipaVoice, so the same record is empty under the IPA spec.
    expect(supportedAnnotationEntries('ipa', { ja: 'x' })).toEqual({});
  });

  it('passes undefined through, so an absent field stays absent', () => {
    expect(supportedAnnotationEntries('ipa', undefined)).toBeUndefined();
  });

  it('returns an empty record when nothing survives', () => {
    expect(supportedAnnotationEntries('ipa', { th: 'x', he: 'y' })).toEqual({});
  });
});
