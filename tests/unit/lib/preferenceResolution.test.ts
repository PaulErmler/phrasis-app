import { describe, expect, it } from 'vitest';
import {
  cardFollowsPreferences,
  parseVariantKey,
  pickPolitenessForm,
  resolveCardRendering,
  resolveLanguageRendering,
  type RenderingCard,
  type RenderingSettings,
  type RenderingText,
} from '@/lib/preferenceResolution';
import { resolveCardSpeakerGenders } from '@/lib/voices';

const premade: RenderingText = { userCreated: false };
const stamped: RenderingCard = { followsCoursePreferences: true };
const legacy: RenderingCard = {};
const textId = 'k17abcdef0123456789';

function resolve(
  code: string,
  settings: RenderingSettings,
  text: RenderingText = premade,
  card: RenderingCard = stamped,
) {
  const cardRendering = resolveCardRendering({ text, textId, settings, card });
  const language = resolveLanguageRendering({
    card: cardRendering,
    code,
    text,
    textId,
    settings,
    cardRow: card,
  });
  return { cardRendering, language };
}

describe('cardFollowsPreferences', () => {
  it('excludes legacy cards and user-written sentences', () => {
    expect(cardFollowsPreferences(premade, stamped)).toBe(true);
    expect(cardFollowsPreferences(premade, null)).toBe(true);
    expect(cardFollowsPreferences(premade, legacy)).toBe(false);
    expect(cardFollowsPreferences({ userCreated: true }, stamped)).toBe(false);
  });
});

describe('resolveCardRendering', () => {
  it('no settings: canonical voice, no variant', () => {
    const { cardRendering, language } = resolve('ru', {});
    expect(cardRendering.gender).toBe('auto');
    expect(cardRendering.voiceGender).toBe(
      resolveCardSpeakerGenders(premade, textId).audioSpeakerGender,
    );
    expect(cardRendering.needsVoice).toBe(false);
    expect(language.textVariantKey).toBeNull();
    expect(language.audioVariantKey).toBeNull();
  });

  it('"both" is canonical', () => {
    const { cardRendering, language } = resolve('ru', {
      firstPersonForms: 'both',
    });
    expect(cardRendering.gender).toBe('auto');
    expect(language.textVariantKey).toBeNull();
    expect(language.audioVariantKey).toBeNull();
  });

  it('a chosen gender sets the voice for every language', () => {
    const settings: RenderingSettings = { firstPersonForms: 'feminine' };
    const ru = resolve('ru', settings);
    const de = resolve('de', settings);
    expect(ru.cardRendering.voiceGender).toBe('female');
    expect(de.cardRendering.voiceGender).toBe('female');
    expect(de.cardRendering.gender).toBe('feminine');
  });

  it('needsVoice only when the canonical coin flip landed on the other gender', () => {
    const canonical = resolveCardSpeakerGenders(premade, textId)
      .audioSpeakerGender;
    const same = canonical === 'male' ? 'masculine' : 'feminine';
    const other = canonical === 'male' ? 'feminine' : 'masculine';
    expect(resolve('de', { firstPersonForms: same }).cardRendering.needsVoice).toBe(false);
    expect(resolve('de', { firstPersonForms: other }).cardRendering.needsVoice).toBe(true);
  });

  it('a definitive text gender wins over the setting', () => {
    const text: RenderingText = { userCreated: false, speakerGender: 'male' };
    const { cardRendering, language } = resolve(
      'ru',
      { firstPersonForms: 'feminine' },
      text,
    );
    expect(cardRendering.gender).toBe('auto');
    expect(cardRendering.voiceGender).toBe('male');
    expect(language.textVariantKey).toBeNull();
    expect(language.audioVariantKey).toBeNull();
  });

  it('a legacy card ignores the settings', () => {
    const { cardRendering, language } = resolve(
      'ja',
      { firstPersonForms: 'feminine', politenessLevels: ['polite'] },
      premade,
      legacy,
    );
    expect(cardRendering.gender).toBe('auto');
    expect(language.textVariantKey).toBeNull();
    expect(language.audioVariantKey).toBeNull();
  });

  it('a user-written text ignores the settings', () => {
    const { language } = resolve(
      'ja',
      { firstPersonForms: 'feminine', politenessLevels: ['polite'] },
      { userCreated: true },
    );
    expect(language.textVariantKey).toBeNull();
    expect(language.audioVariantKey).toBeNull();
  });
});

describe('resolveLanguageRendering', () => {
  it('a marked language with a chosen gender needs a text variant', () => {
    const { language } = resolve('ru', { firstPersonForms: 'feminine' });
    expect(language.textVariantKey).toBe('female|auto');
    expect(language.audioVariantKey).toBe('female|auto');
    expect(language.voiceGender).toBe('female');
  });

  it('an unmarked language with a chosen gender needs audio only when the voice differs', () => {
    const canonical = resolveCardSpeakerGenders(premade, textId)
      .audioSpeakerGender;
    const other = canonical === 'male' ? 'feminine' : 'masculine';
    const same = canonical === 'male' ? 'masculine' : 'feminine';
    const differs = resolve('de', { firstPersonForms: other }).language;
    expect(differs.textVariantKey).toBeNull();
    expect(differs.audioVariantKey).toBe(
      `${other === 'masculine' ? 'male' : 'female'}|auto`,
    );
    const matches = resolve('de', { firstPersonForms: same }).language;
    expect(matches.textVariantKey).toBeNull();
    expect(matches.audioVariantKey).toBeNull();
  });

  it('a single politeness level is a fixed form', () => {
    const { language } = resolve('ja', { politenessLevels: ['polite'] });
    expect(language.form?.id).toBe('desu-masu');
    expect(language.textVariantKey).toBe('auto|desu-masu');
    expect(language.audioVariantKey).toBe(
      `${language.voiceGender}|desu-masu`,
    );
  });

  it('levels that map to one form on this language do not alternate', () => {
    const { language } = resolve('de', {
      politenessLevels: ['casual', 'polite'],
    });
    expect(language.form?.id).toBe('t');
  });

  it('several forms alternate deterministically per text', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const form = pickPolitenessForm(
        'ja',
        ['casual', 'polite', 'formal'],
        `text${i}`,
      );
      seen.add(form!.id);
      expect(
        pickPolitenessForm('ja', ['casual', 'polite', 'formal'], `text${i}`)!
          .id,
      ).toBe(form!.id);
    }
    expect(seen.size).toBe(3);
  });

  it('an address language without a "you" stays canonical', () => {
    const noAddressee: RenderingText = {
      userCreated: false,
      addressesSomeone: false,
    };
    const { language } = resolve(
      'de',
      { politenessLevels: ['formal'] },
      noAddressee,
    );
    expect(language.form).toBeNull();
    expect(language.textVariantKey).toBeNull();
    expect(language.audioVariantKey).toBeNull();
  });

  it('the legacy addressee fallback reads addresseeNumber', () => {
    const legacyNoAddressee: RenderingText = {
      userCreated: false,
      addresseeNumber: 'not_applicable',
    };
    expect(
      resolve('de', { politenessLevels: ['formal'] }, legacyNoAddressee).language
        .form,
    ).toBeNull();
    const legacyAddressee: RenderingText = {
      userCreated: false,
      addresseeNumber: 'singular',
    };
    expect(
      resolve('de', { politenessLevels: ['formal'] }, legacyAddressee).language
        .form?.id,
    ).toBe('v');
  });

  it('a predicate language ignores the addressee gate', () => {
    const noAddressee: RenderingText = {
      userCreated: false,
      addressesSomeone: false,
    };
    const { language } = resolve(
      'ko',
      { politenessLevels: ['formal'] },
      noAddressee,
    );
    expect(language.form?.id).toBe('hapsyo');
  });

  it('an unmarked language ignores politeness', () => {
    const { language } = resolve('sv', { politenessLevels: ['formal'] });
    expect(language.textVariantKey).toBeNull();
    expect(language.audioVariantKey).toBeNull();
  });

  it('both axes combine into one key', () => {
    const { language } = resolve('ja', {
      firstPersonForms: 'masculine',
      politenessLevels: ['casual'],
    });
    expect(language.textVariantKey).toBe('male|plain');
    expect(language.audioVariantKey).toBe('male|plain');
    expect(parseVariantKey(language.textVariantKey!)).toEqual({
      gender: 'male',
      formId: 'plain',
    });
  });

  it('a politeness variant of a gender-unmarked language has one wording per form', () => {
    const settings: RenderingSettings = {
      firstPersonForms: 'feminine',
      politenessLevels: ['formal'],
    };
    const { language } = resolve('de', settings);
    expect(language.textVariantKey).toBe('auto|v');
    expect(language.audioVariantKey).toBe('female|v');
  });

  it('mixed dialects resolve through the concrete sub-code', () => {
    const { language } = resolve('es_latam', { politenessLevels: ['polite'] });
    expect(language.form?.id).toBe('v');
    const spain = resolve('es', { politenessLevels: ['polite'] }).language;
    expect(spain.form?.id).toBe('t');
  });
});
