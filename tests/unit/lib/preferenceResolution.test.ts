import { describe, expect, it } from 'vitest';
import {
  axisOf,
  cardAcceptsLegacyRow,
  cardFollowsPreferences,
  NO_FORM,
  parseRenderingKey,
  pickPolitenessForm,
  primaryRenderingKey,
  renderingKey,
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

/** The text's own (seeded) voice for `premade` and the other one. */
const textVoice = resolveCardSpeakerGenders(premade, textId).audioSpeakerGender;
const otherVoice = textVoice === 'male' ? 'female' : 'male';
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

describe('keys', () => {
  it('map a gender axis onto its voice and back', () => {
    expect(voiceOf('masculine')).toBe('male');
    expect(voiceOf('feminine')).toBe('female');
    expect(axisOf('male')).toBe('masculine');
    expect(axisOf('female')).toBe('feminine');
  });

  it('build and parse a rendering key', () => {
    expect(renderingKey('female', 'desu-masu')).toBe('female|desu-masu');
    expect(parseRenderingKey('male|none')).toEqual({
      voice: 'male',
      formId: NO_FORM,
    });
    expect(parseRenderingKey('female|v').formId).toBe('v');
  });
});

describe('resolveSourceRendering', () => {
  it('voices the source wording in the card voice under a form-free key', () => {
    const card = resolveCardRendering({
      text: premade,
      textId,
      card: corrected(),
    });
    const source = resolveSourceRendering(card);
    expect(source.form).toBeNull();
    expect(source.formId).toBe(NO_FORM);
    expect(source.key).toBe(`${otherVoice}|none`);
    expect(source.voiceGender).toBe(otherVoice);
  });
});

describe('cardFollowsPreferences', () => {
  it('excludes legacy cards and user-written sentences', () => {
    expect(cardFollowsPreferences(premade, stamped)).toBe(true);
    expect(cardFollowsPreferences(premade, null)).toBe(true);
    expect(cardFollowsPreferences(premade, legacy)).toBe(false);
    expect(cardFollowsPreferences({ userCreated: true }, stamped)).toBe(false);
  });

  it('legacy rows are the answer for user texts and uncorrected legacy cards only', () => {
    expect(cardAcceptsLegacyRow({ userCreated: true }, stamped)).toBe(true);
    expect(cardAcceptsLegacyRow(premade, legacy)).toBe(true);
    expect(cardAcceptsLegacyRow(premade, stamped)).toBe(false);
    expect(cardAcceptsLegacyRow(premade, null)).toBe(false);
    expect(
      cardAcceptsLegacyRow(premade, { renderingPolitenessOverride: 'polite' }),
    ).toBe(false);
  });
});

describe('resolveCardRendering', () => {
  it('the voice is always decided: the text voice without a correction', () => {
    const { cardRendering, language } = resolve('ru', {});
    expect(cardRendering.voiceGender).toBe(textVoice);
    expect(cardRendering.textVoiceGender).toBe(textVoice);
    expect(cardRendering.acceptsLegacyRow).toBe(false);
    expect(parseRenderingKey(language.key).voice).toBe(textVoice);
  });

  it('the settings alone never leave the text voice', () => {
    const { cardRendering, language } = resolve('ru', {
      politenessLevels: ['casual', 'polite', 'formal'],
    });
    expect(cardRendering.voiceGender).toBe(textVoice);
    expect(parseRenderingKey(language.key).voice).toBe(textVoice);
  });

  it('a corrected card sets the voice for every language', () => {
    const ru = resolve('ru', {}, premade, corrected());
    const tr = resolve('tr', {}, premade, corrected());
    expect(ru.cardRendering.voiceGender).toBe(otherVoice);
    expect(tr.cardRendering.voiceGender).toBe(otherVoice);
    expect(tr.cardRendering.textVoiceGender).toBe(textVoice);
    expect(parseRenderingKey(tr.language.key).voice).toBe(otherVoice);
  });

  it('a legacy card accepts legacy rows and resolves to the primary key', () => {
    const { cardRendering, language } = resolve(
      'ja',
      { politenessLevels: ['casual'] },
      premade,
      legacy,
    );
    expect(cardRendering.acceptsLegacyRow).toBe(true);
    // The setting is ignored; the primary form of a ja sentence with no
    // register metadata is the language default, です・ます.
    expect(language.form?.id).toBe('desu-masu');
    expect(language.key).toBe(`${textVoice}|desu-masu`);
  });

  it('a user-written text is one rendering with no form, and accepts legacy rows', () => {
    const { cardRendering, language } = resolve(
      'ja',
      { politenessLevels: ['polite'] },
      { userCreated: true, audioSpeakerGender: 'female' },
    );
    expect(cardRendering.acceptsLegacyRow).toBe(true);
    expect(language.form).toBeNull();
    expect(language.key).toBe('female|none');
  });
});

describe('resolveLanguageRendering', () => {
  it('a single politeness level is a fixed form', () => {
    const { language } = resolve('ja', { politenessLevels: ['polite'] });
    expect(language.form?.id).toBe('desu-masu');
    expect(language.key).toBe(`${textVoice}|desu-masu`);
  });

  it('no setting means the primary form: register decides, else the default', () => {
    expect(resolve('ja', {}).language.form?.id).toBe('desu-masu');
    expect(
      resolve('ja', {}, { userCreated: false, register: 'informal' }).language
        .form?.id,
    ).toBe('plain');
    expect(
      resolve('de', {}, { userCreated: false, register: 'formal' }).language
        .form?.id,
    ).toBe('v');
    expect(
      resolve('de', {}, { userCreated: false, register: 'neutral' }).language
        .form?.id,
    ).toBe('t');
    // Spanish is familiar-split: formal register is still the usted form.
    expect(
      resolve('es', {}, { userCreated: false, register: 'formal' }).language
        .form?.id,
    ).toBe('v');
  });

  // Spain Spanish is a FAMILIAR split (casual and polite both render tú), so
  // this level set really does collapse to one form.
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
  // one whatever salt it used.
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

  it('an address language without a "you" has no form: the key says none', () => {
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
    expect(language.key).toBe(`${textVoice}|none`);
    expect(resolve('tr', {}, noAddressee).language.key).toBe(
      `${textVoice}|none`,
    );
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

  it('a predicate language marks every sentence', () => {
    const noAddressee: RenderingText = {
      userCreated: false,
      addressesSomeone: false,
    };
    expect(
      resolve('ko', { politenessLevels: ['formal'] }, noAddressee).language
        .form?.id,
    ).toBe('hapsyo');
    expect(resolve('ko', {}, noAddressee).language.form?.id).toBe('haeyo');
  });

  it('a pronoun language has a default form too', () => {
    expect(resolve('vi', {}).language.form?.id).toBe('respectful');
    expect(
      resolve('vi', {}, { userCreated: false, register: 'informal' }).language
        .form?.id,
    ).toBe('peer');
  });

  it('an unmarked language is always form-free', () => {
    const { language } = resolve('sv', { politenessLevels: ['formal'] });
    expect(language.form).toBeNull();
    expect(language.key).toBe(`${textVoice}|none`);
  });

  it('both axes combine into one key', () => {
    const { language } = resolve(
      'ja',
      { politenessLevels: ['casual'] },
      premade,
      { ...stamped, renderingGenderOverride: 'male' },
    );
    expect(language.key).toBe('male|plain');
    expect(parseRenderingKey(language.key)).toEqual({
      voice: 'male',
      formId: 'plain',
    });
  });

  it('a gender-unmarked language still keys its wording by the voice', () => {
    const settings: RenderingSettings = { politenessLevels: ['formal'] };
    const { language } = resolve('tr', settings, premade, {
      ...stamped,
      renderingGenderOverride: 'female',
    });
    expect(language.key).toBe('female|v');
  });

  it('mixed dialects resolve through the concrete sub-code', () => {
    const { language } = resolve('es_latam', { politenessLevels: ['polite'] });
    expect(language.form?.id).toBe('v');
    const spain = resolve('es', { politenessLevels: ['polite'] }).language;
    expect(spain.form?.id).toBe('t');
  });
});

describe('primaryRenderingKey', () => {
  it('is the text voice plus the primary form', () => {
    expect(primaryRenderingKey({ text: premade, textId, code: 'ja' })).toBe(
      `${textVoice}|desu-masu`,
    );
    expect(
      primaryRenderingKey({
        text: { userCreated: false, addressesSomeone: false },
        textId,
        code: 'de',
      }),
    ).toBe(`${textVoice}|none`);
    expect(
      primaryRenderingKey({
        text: { userCreated: true, audioSpeakerGender: 'male' },
        textId,
        code: 'ja',
      }),
    ).toBe('male|none');
  });

  it('equals what a card with no override and no setting resolves to', () => {
    for (const code of ['ja', 'de', 'tr', 'sv', 'es_mixed']) {
      const { language } = resolve(code, {}, premade, null);
      expect(primaryRenderingKey({ text: premade, textId, code })).toBe(
        language.key,
      );
    }
  });
});

describe('per-card overrides and sentence evidence', () => {
  const current = 'gemini-3.1-flash-lite-v1';

  it('the override applies to a legacy card without any settings', () => {
    const descriptive: RenderingText = {
      userCreated: false,
      addressesSomeone: false,
    };
    const { cardRendering, language } = resolve('ru', {}, descriptive, {
      renderingGenderOverride: 'female',
    });
    expect(cardRendering.voiceGender).toBe('female');
    // The correction moves the card onto a keyed row; its legacy row is no
    // longer the answer.
    expect(cardRendering.acceptsLegacyRow).toBe(false);
    expect(language.key).toBe('female|none');
  });

  it('a text with no addressee metadata at all is read as addressing someone', () => {
    // The legacy fallback of the prompt: `addresseeNumber` undefined is not
    // 'not_applicable', so the T form is the primary until a verdict lands.
    expect(resolve('ru', {}, premade).language.form?.id).toBe('t');
  });

  it('a politeness override picks its own form without the settings', () => {
    const { language } = resolve('ja', {}, premade, {
      renderingPolitenessOverride: 'polite',
    });
    expect(language.form?.id).toBe('desu-masu');
    expect(language.key).toBe(`${textVoice}|desu-masu`);
  });

  it('a politeness override on an address language ignores the addressee gate', () => {
    const noAddressee: RenderingText = {
      userCreated: false,
      addressesSomeone: false,
    };
    const { language } = resolve('tr', {}, noAddressee, {
      renderingPolitenessOverride: 'formal',
    });
    expect(language.form?.id).toBe('v');
    expect(language.key).toBe(`${textVoice}|v`);
  });

  it('a definitive speaker gender at the current source outranks the override', () => {
    const text: RenderingText = {
      userCreated: false,
      speakerGender: 'male',
      audioSpeakerGender: 'male',
      addressesSomeone: false,
      metadataSource: current,
    };
    const { cardRendering, language } = resolve('ru', {}, text, {
      followsCoursePreferences: true,
      renderingGenderOverride: 'female',
    });
    expect(cardRendering.voiceGender).toBe('male');
    expect(language.key).toBe('male|none');
  });

  it('a flip written into speakerGender before the cutover is not evidence', () => {
    const text: RenderingText = {
      userCreated: false,
      speakerGender: 'male',
      audioSpeakerGender: 'male',
    };
    const { cardRendering } = resolve('ru', {}, text, {
      ...stamped,
      renderingGenderOverride: 'female',
    });
    expect(cardRendering.voiceGender).toBe('female');
  });

  it('an override is inert on a user-written text', () => {
    const { cardRendering, language } = resolve(
      'ru',
      {},
      { userCreated: true, audioSpeakerGender: 'male' },
      {
        renderingGenderOverride: 'female',
        renderingPolitenessOverride: 'polite',
      },
    );
    expect(cardRendering.voiceGender).toBe('male');
    expect(language.key).toBe('male|none');
  });
});
