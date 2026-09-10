import { describe, expect, it } from 'vitest';
import {
  buildAutofillSettingsBlock,
  buildAutofillUserPrompt,
} from '../../../convex/lib/translationAutofillPrompt';
import { buildFormChips } from '../../../components/app/learning/formChips';

describe('autofill speaker block', () => {
  it('is empty without a drawn speaker and names one otherwise', () => {
    expect(buildAutofillSettingsBlock(undefined)).toBe('');
    // The drawn speaker replaces rule 3's default for an unmarked source.
    const spoken = buildAutofillSettingsBlock('female');
    expect(spoken).toContain('agrees with a woman speaking');
    expect(spoken).toContain('Report speakerGender as "female"');
    expect(
      buildAutofillUserPrompt({
        texts: [{ language: 'de', text: 'Ich bin müde.' }],
        resolvedTargets: ['th'],
        speakerGender: 'male',
      }),
    ).toContain('agrees with a man speaking');
  });
});

describe('buildFormChips', () => {
  const t = (key: string) => key.toUpperCase();

  it('shows the card voice once', () => {
    const chips = buildFormChips(
      [
        { language: 'en', isTargetLanguage: false, voiceGender: 'female' },
        { language: 'ja', isTargetLanguage: true, voiceGender: 'female' },
      ],
      t,
    );
    expect(chips.map((c) => c.label)).toEqual(['FEMININE']);
    expect(chips.map((c) => c.testId)).toEqual(['form-chip-feminine']);
  });

  it('is the card voice, and nothing without one', () => {
    const chips = buildFormChips(
      [{ language: 'ru', isTargetLanguage: true, voiceGender: 'male' }],
      t,
    );
    expect(chips.map((c) => c.label)).toEqual(['MASCULINE']);
    expect(
      buildFormChips([{ language: 'ru', isTargetLanguage: true }], t),
    ).toEqual([]);
  });
});
