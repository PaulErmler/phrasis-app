import { describe, expect, it } from 'vitest';
import { buildFormsSection } from '../../../convex/features/chat/promptSections';
import {
  buildAutofillSettingsBlock,
  buildAutofillUserPrompt,
} from '../../../convex/lib/translationAutofillPrompt';
import { expandQuickAction } from '../../../convex/features/chat/quickActions';
import { buildFormChips } from '../../../components/app/learning/formChips';

describe('buildFormsSection (chat)', () => {
  it('is absent without settings', () => {
    expect(
      buildFormsSection(undefined, {
        baseLanguages: ['en'],
        targetLanguages: ['ja'],
      }),
    ).toBeUndefined();
    expect(
      buildFormsSection(
        {},
        { baseLanguages: ['en'], targetLanguages: ['de'] },
      ),
    ).toBeUndefined();
  });

  it('names the forms per language and never a gender', () => {
    const section = buildFormsSection(
      { politenessLevels: ['polite'] },
      { baseLanguages: ['en'], targetLanguages: ['ja', 'de'] },
    )!;
    expect(section).not.toContain('First-person forms');
    expect(section).toContain(
      'Japanese politeness: the learner studies the Polite · です・ます',
    );
    expect(section).toContain(
      'German politeness: the learner studies the Polite · Sie',
    );
  });

  it('says when several forms are mixed', () => {
    const section = buildFormsSection(
      { politenessLevels: ['casual', 'polite', 'formal'] },
      { baseLanguages: ['en'], targetLanguages: ['ko'] },
    )!;
    expect(section).toContain('sees them mixed');
  });
});

describe('autofill settings block', () => {
  it('is empty without settings and names forms per target otherwise', () => {
    expect(buildAutofillSettingsBlock(undefined, ['ja'], 'seed')).toBe('');
    const block = buildAutofillSettingsBlock(
      { politenessLevels: ['formal'] },
      ['ja', 'de', 'sv'],
      'seed',
    );
    expect(block).not.toContain('Speaker:');
    expect(block).toContain('Formal · keigo');
    // The drawn speaker replaces rule 3's default even without settings.
    const spoken = buildAutofillSettingsBlock(undefined, ['th'], 'seed', 'female');
    expect(spoken).toContain('agrees with a woman speaking');
    expect(spoken).toContain('Report speakerGender as "female"');
    expect(
      buildAutofillUserPrompt({
        texts: [{ language: 'de', text: 'Ich bin müde.' }],
        resolvedTargets: ['th'],
        speakerGender: 'male',
      }),
    ).toContain('agrees with a man speaking');
    expect(block).toContain('Polite · Sie');
    expect(block).not.toContain('Swedish');
    const prompt = buildAutofillUserPrompt({
      texts: [{ language: 'en', text: 'Hello' }],
      resolvedTargets: ['ja'],
      settings: { politenessLevels: ['polite'] },
    });
    expect(prompt).toContain('Course settings');
  });
});

describe('formal quick action anchor', () => {
  const card = {
    sourceText: 'Are you coming?',
    sourceLanguage: 'en',
    translations: [{ language: 'ja', text: '来ますか？' }],
  };
  it('starts from the studied form when the course has one', () => {
    const steering = expandQuickAction(
      { kind: 'formal' },
      {
        card,
        baseLanguages: ['en'],
        targetLanguages: ['ja'],
        renderingSettings: { politenessLevels: ['polite'] },
      },
    );
    expect(steering).toContain('Japanese: Polite · です・ます');
    expect(steering).toContain('MORE formal than the form on the card');
    const plain = expandQuickAction(
      { kind: 'formal' },
      { card, baseLanguages: ['en'], targetLanguages: ['ja'] },
    );
    expect(plain).not.toContain('MORE formal than');
  });
});

describe('buildFormChips', () => {
  const t = (key: string) => key.toUpperCase();
  it('shows the card voice once, own form names for ja/ko and generic words elsewhere', () => {
    const chips = buildFormChips(
      [
        { language: 'en', isTargetLanguage: false, voiceGender: 'female' },
        {
          language: 'ja',
          isTargetLanguage: true,
          voiceGender: 'female',
          politenessLevel: 'polite',
        },
        {
          language: 'de',
          isTargetLanguage: true,
          voiceGender: 'female',
          politenessLevel: 'formal',
        },
      ],
      t,
    );
    expect(chips.map((c) => c.label)).toEqual([
      'FEMININE',
      'JA です・ます',
      'DE FORMAL',
    ]);
    // The title keeps the level and the language's own form.
    expect(chips[2].title).toBe('POLITENESSTITLE');
  });

  it('a two-form language reads casual or formal by the form the level maps to', () => {
    const label = (language: string, level: 'casual' | 'polite' | 'formal') =>
      buildFormChips(
        [{ language, isTargetLanguage: true, politenessLevel: level }],
        t,
      )[0].label;
    // Dutch: je covers casual and polite, u is formal.
    expect(label('nl', 'casual')).toBe('CASUAL');
    expect(label('nl', 'polite')).toBe('CASUAL');
    expect(label('nl', 'formal')).toBe('FORMAL');
    // Spanish and German: the high form from the polite level.
    expect(label('es', 'casual')).toBe('CASUAL');
    expect(label('es', 'polite')).toBe('FORMAL');
    expect(label('de', 'polite')).toBe('FORMAL');
    expect(label('ko', 'casual')).toBe('반말');
  });

  it('the gender chip is the card voice, and nothing without one', () => {
    const chips = buildFormChips(
      [{ language: 'ru', isTargetLanguage: true, voiceGender: 'male' }],
      t,
    );
    expect(chips.map((c) => c.label)).toEqual(['MASCULINE']);
    expect(
      buildFormChips([{ language: 'ru', isTargetLanguage: true }], t).map(
        (c) => c.label,
      ),
    ).toEqual([]);
  });

  it('drops the language prefix when the targets agree and hides unmarked rows', () => {
    const chips = buildFormChips(
      [
        {
          language: 'de',
          isTargetLanguage: true,
          politenessLevel: 'formal',
        },
        {
          language: 'fr',
          isTargetLanguage: true,
          politenessLevel: 'polite',
        },
        { language: 'sv', isTargetLanguage: true },
      ],
      t,
    );
    expect(chips.map((c) => c.label)).toEqual(['FORMAL', 'FORMAL']);
    expect(
      buildFormChips([{ language: 'sv', isTargetLanguage: true }], t),
    ).toEqual([]);
  });
});
