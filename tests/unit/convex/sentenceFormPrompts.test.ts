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
        { firstPersonForms: 'both' },
        { baseLanguages: ['en'], targetLanguages: ['de'] },
      ),
    ).toBeUndefined();
  });

  it('names the forms per language and the gender', () => {
    const section = buildFormsSection(
      { firstPersonForms: 'feminine', politenessLevels: ['polite'] },
      { baseLanguages: ['en'], targetLanguages: ['ja', 'de'] },
    )!;
    expect(section).toContain('feminine form');
    expect(section).toContain(
      'Japanese politeness: the learner studies the Polite · です・ます',
    );
    expect(section).toContain(
      'German politeness: the learner studies the du-form · everyday',
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
      { firstPersonForms: 'masculine', politenessLevels: ['formal'] },
      ['ja', 'de', 'sv'],
      'seed',
    );
    expect(block).toContain('the speaker is a man');
    expect(block).toContain('Formal · keigo');
    expect(block).toContain('Sie-form · formal');
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
  it('shows the gender once and the form per target, own names for two-form languages', () => {
    const chips = buildFormChips(
      [
        { language: 'en', isTargetLanguage: false, renderedGender: 'feminine' },
        {
          language: 'ja',
          isTargetLanguage: true,
          renderedGender: 'feminine',
          renderedPoliteness: 'polite',
        },
        {
          language: 'de',
          isTargetLanguage: true,
          renderedPoliteness: 'formal',
        },
      ],
      t,
    );
    expect(chips.map((c) => c.label)).toEqual([
      'FEMININE',
      'JA POLITE',
      'DE Sie-form',
    ]);
  });

  it('drops the language prefix when the targets agree and hides unmarked rows', () => {
    const chips = buildFormChips(
      [
        {
          language: 'ja',
          isTargetLanguage: true,
          renderedPoliteness: 'polite',
        },
        {
          language: 'ko',
          isTargetLanguage: true,
          renderedPoliteness: 'polite',
        },
        { language: 'sv', isTargetLanguage: true },
      ],
      t,
    );
    expect(chips.map((c) => c.label)).toEqual(['POLITE', 'POLITE']);
    expect(
      buildFormChips([{ language: 'sv', isTargetLanguage: true }], t),
    ).toEqual([]);
  });
});
