import { describe, expect, it } from 'vitest';
import {
  axisOf,
  cardFollowsPreferences,
  parseVariantKey,
  pickPolitenessForm,
  resolveCardRendering,
  resolveLanguageRendering,
  resolveSourceRendering,
  voiceOf,
  type RenderingCard,
  type RenderingSettings,
  type RenderingText,
} from '@/lib/preferenceResolution';
import { resolveCardSpeakerGenders } from '@/lib/voices';

const premade: RenderingText = { userCreated: false };
const stamped: RenderingCard = { followsCoursePreferences: true };
const legacy: RenderingCard = {};
const textId = 'k17abcdef0123456789';

/** The canonical (coin-flip) voice of `premade` and the other one. */
const canonicalVoice = resolveCardSpeakerGenders(
  premade,
  textId,
).audioSpeakerGender;
const otherVoice = canonicalVoice === 'male' ? 'female' : 'male';
/** A card corrected to the other voice, the one way a card leaves its gender. */
const corrected = (card: RenderingCard = stamped): RenderingCard => ({
  ...card,
  renderingGenderOverride: otherVoice,
});

function resolve(
  code: string,
  settings: RenderingSettings,
  text: RenderingText = premade,
  card: RenderingCard = stamped,
) {
  const cardRendering = resolveCardRendering({ text, textId, card });
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

describe('voiceOf / axisOf', () => {
  it('map a gender axis onto its voice and back', () => {
    expect(voiceOf('masculine')).toBe('male');
    expect(voiceOf('feminine')).toBe('female');
    expect(axisOf('male')).toBe('masculine');
    expect(axisOf('female')).toBe('feminine');
  });
});

describe('resolveSourceRendering', () => {
  it('voices the source wording in the card voice and never rewrites it', () => {
    const card = resolveCardRendering({
      text: premade,
      textId,
      card: corrected(),
    });
    const source = resolveSourceRendering(card);
    expect(source.form).toBeNull();
    expect(source.textVariantKey).toBeNull();
    expect(source.audioVariantKey).toBe(`${otherVoice}|auto`);
    expect(source.voiceGender).toBe(otherVoice);
  });

  it('is canonical when the canonical voice already is the card voice', () => {
    const card = resolveCardRendering({
      text: premade,
      textId,
      card: { ...stamped, renderingGenderOverride: canonicalVoice },
    });
    expect(resolveSourceRendering(card).audioVariantKey).toBeNull();
  });
});

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

  it('there is no course gender: the settings alone never leave the canonical voice', () => {
    const { cardRendering, language } = resolve('ru', {
      politenessLevels: ['casual', 'polite', 'formal'],
    });
    expect(cardRendering.gender).toBe('auto');
    expect(cardRendering.voiceGender).toBe(canonicalVoice);
    expect(cardRendering.needsVoice).toBe(false);
    // A politeness form may be picked; the gender axis of its keys is
    // canonical and its clip is in the text's own voice.
    expect(parseVariantKey(language.textVariantKey!).gender).toBe('auto');
    expect(parseVariantKey(language.audioVariantKey!).gender).toBe(
      canonicalVoice,
    );
  });

  it('a corrected card sets the voice for every language', () => {
    const ru = resolve('ru', {}, premade, corrected());
    const tr = resolve('tr', {}, premade, corrected());
    expect(ru.cardRendering.voiceGender).toBe(otherVoice);
    expect(tr.cardRendering.voiceGender).toBe(otherVoice);
    expect(tr.cardRendering.gender).toBe(axisOf(otherVoice));
  });

  it('needsVoice only when the canonical coin flip landed on the other gender', () => {
    expect(
      resolve('tr', {}, premade, {
        ...stamped,
        renderingGenderOverride: canonicalVoice,
      }).cardRendering.needsVoice,
    ).toBe(false);
    expect(
      resolve('tr', {}, premade, corrected()).cardRendering.needsVoice,
    ).toBe(true);
  });

  it("a curriculum text's speakerGender stamp is the coin flip, not evidence", () => {
    // The sweep writes the canonical voice gender back onto premade texts
    // (resolveCardSpeakerGenders case 3); the correction still applies.
    const text: RenderingText = {
      userCreated: false,
      speakerGender: 'male',
      audioSpeakerGender: 'male',
    };
    const { cardRendering, language } = resolve('ru', {}, text, {
      ...stamped,
      renderingGenderOverride: 'female',
    });
    expect(cardRendering.gender).toBe('feminine');
    expect(cardRendering.voiceGender).toBe('female');
    expect(cardRendering.needsVoice).toBe(true);
    expect(language.textVariantKey).toBe('female|auto');
  });

  it('a legacy card ignores the settings', () => {
    const { cardRendering, language } = resolve(
      'ja',
      { politenessLevels: ['polite'] },
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
      { politenessLevels: ['polite'] },
      { userCreated: true },
    );
    expect(language.textVariantKey).toBeNull();
    expect(language.audioVariantKey).toBeNull();
  });
});

describe('resolveLanguageRendering', () => {
  it('a marked language on a corrected card needs a text variant', () => {
    const { language } = resolve('ru', {}, premade, corrected());
    expect(language.textVariantKey).toBe(`${otherVoice}|auto`);
    expect(language.audioVariantKey).toBe(`${otherVoice}|auto`);
    expect(language.voiceGender).toBe(otherVoice);
  });

  it('an unmarked language on a corrected card needs audio only when the voice differs', () => {
    const differs = resolve('tr', {}, premade, corrected()).language;
    expect(differs.textVariantKey).toBeNull();
    expect(differs.audioVariantKey).toBe(`${otherVoice}|auto`);
    const matches = resolve('tr', {}, premade, {
      ...stamped,
      renderingGenderOverride: canonicalVoice,
    }).language;
    expect(matches.textVariantKey).toBeNull();
    expect(matches.audioVariantKey).toBeNull();
  });

  it('a single politeness level is a fixed form', () => {
    const { language } = resolve('ja', { politenessLevels: ['polite'] });
    expect(language.form?.id).toBe('desu-masu');
    expect(language.textVariantKey).toBe('auto|desu-masu');
    expect(language.audioVariantKey).toBe(`${language.voiceGender}|desu-masu`);
  });

  // Spain Spanish is a FAMILIAR split (casual and polite both render tú), so
  // this level set really does collapse to one form. Turkish, which this test
  // used before, is a distance split: casual+polite is {t, v} there and the
  // form alternates, so the old assertion only passed because the fixture id
  // happened to hash to index 0.
  it('levels that map to one form on this language do not alternate', () => {
    const { language } = resolve('es', {
      politenessLevels: ['casual', 'polite'],
    });
    expect(language.form?.id).toBe('t');
    for (let i = 0; i < 50; i++) {
      expect(
        pickPolitenessForm('es', ['casual', 'polite'], `no-alt-${i}`)!.id,
      ).toBe('t');
    }
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

  // 2026-09-08 review: `fnv1a(seed) % 2` is the seed's character parity and
  // nothing more, so every two-way pick on one textId agreed with every other
  // one whatever salt it used. The politeness form was a bit-for-bit copy of
  // the speaker-gender coin: `du` on every male-voiced card, `Sie` on every
  // female-voiced one, and never the other two combinations. Only ja and ko
  // escaped, because three forms means `% 3`.
  it('the form of a two-form language is independent of the speaker gender', () => {
    for (const [code, levels] of [
      ['de', ['casual', 'polite']],
      ['es', ['casual', 'formal']],
      ['th', ['casual', 'polite']],
    ] as const) {
      const combinations = new Map<string, number>();
      for (let i = 0; i < 2000; i++) {
        const id = `text-${code}-${i}`;
        const form = pickPolitenessForm(code, levels, id);
        const { audioSpeakerGender } = resolveCardSpeakerGenders(premade, id);
        const key = `${audioSpeakerGender}|${form!.id}`;
        combinations.set(key, (combinations.get(key) ?? 0) + 1);
      }
      // All four combinations occur, and none is rare enough to look like a
      // leak: a perfect correlation shows up here as two missing keys.
      expect(combinations.size).toBe(4);
      for (const count of combinations.values()) {
        expect(count).toBeGreaterThan(300);
      }
    }
  });

  it('the form pick is stable across calls for one text', () => {
    for (let i = 0; i < 50; i++) {
      const id = `stable-${i}`;
      const first = pickPolitenessForm('de', ['casual', 'polite'], id);
      expect(pickPolitenessForm('de', ['casual', 'polite'], id)!.id).toBe(
        first!.id,
      );
    }
  });

  it('an address language without a "you" stays canonical', () => {
    const noAddressee: RenderingText = {
      userCreated: false,
      addressesSomeone: false,
    };
    const { language } = resolve(
      'tr',
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
      resolve('tr', { politenessLevels: ['formal'] }, legacyNoAddressee)
        .language.form,
    ).toBeNull();
    const legacyAddressee: RenderingText = {
      userCreated: false,
      addresseeNumber: 'singular',
    };
    expect(
      resolve('tr', { politenessLevels: ['formal'] }, legacyAddressee).language
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
    const { language } = resolve(
      'ja',
      { politenessLevels: ['casual'] },
      premade,
      {
        ...stamped,
        renderingGenderOverride: 'male',
      },
    );
    expect(language.textVariantKey).toBe('male|plain');
    expect(language.audioVariantKey).toBe('male|plain');
    expect(parseVariantKey(language.textVariantKey!)).toEqual({
      gender: 'male',
      formId: 'plain',
    });
  });

  it('a politeness variant of a gender-unmarked language has one wording per form', () => {
    const settings: RenderingSettings = { politenessLevels: ['formal'] };
    const { language } = resolve('tr', settings, premade, {
      ...stamped,
      renderingGenderOverride: 'female',
    });
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

describe('per-card overrides and sentence evidence', () => {
  const current = 'gemini-3.1-flash-lite-v1';

  it('the override applies to a legacy card without any settings', () => {
    const { cardRendering, language } = resolve('ru', {}, premade, {
      renderingGenderOverride: 'female',
    });
    expect(cardRendering.gender).toBe('feminine');
    expect(cardRendering.voiceGender).toBe('female');
    expect(language.textVariantKey).toBe('female|auto');
  });

  it('a politeness override picks its own form without the settings', () => {
    const { language } = resolve('ja', {}, premade, {
      renderingPolitenessOverride: 'polite',
    });
    expect(language.form?.id).toBe('desu-masu');
    expect(language.textVariantKey).toBe('auto|desu-masu');
  });

  it('a politeness override on an address language ignores the addressee gate', () => {
    // The classifier said the sentence addresses nobody; the learner says the
    // "you" form is wrong. The override is the correction of exactly that
    // verdict, so it renders instead of being nulled to canonical.
    const noAddressee: RenderingText = {
      userCreated: false,
      addressesSomeone: false,
    };
    const { language } = resolve('tr', {}, noAddressee, {
      renderingPolitenessOverride: 'formal',
    });
    expect(language.form).not.toBeNull();
    expect(language.textVariantKey).toBe(`auto|${language.form!.id}`);
  });

  it('a definitive speaker gender at the current source outranks the override', () => {
    const text: RenderingText = {
      userCreated: false,
      speakerGender: 'male',
      audioSpeakerGender: 'male',
      metadataSource: current,
    };
    const { cardRendering, language } = resolve('ru', {}, text, {
      followsCoursePreferences: true,
      renderingGenderOverride: 'female',
    });
    expect(cardRendering.gender).toBe('auto');
    expect(cardRendering.voiceGender).toBe('male');
    expect(language.textVariantKey).toBeNull();
  });

  it('the coin flip written back on an unclassified text is not evidence', () => {
    const text: RenderingText = {
      userCreated: false,
      speakerGender: 'male',
      audioSpeakerGender: 'male',
    };
    const { cardRendering } = resolve('ru', {}, text, {
      ...stamped,
      renderingGenderOverride: 'female',
    });
    expect(cardRendering.gender).toBe('feminine');
  });

  it('an override is inert on a user-written text', () => {
    const { cardRendering, language } = resolve(
      'ru',
      {},
      { userCreated: true },
      {
        renderingGenderOverride: 'female',
        renderingPolitenessOverride: 'polite',
      },
    );
    expect(cardRendering.gender).toBe('auto');
    expect(language.textVariantKey).toBeNull();
  });
});
