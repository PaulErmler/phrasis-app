import { describe, expect, it } from 'vitest';
import {
  annotationLinePropsFromSettings,
  annotationDisplayByLanguage,
  hyperliteralWantsFor,
  resolveAnnotationDisplay,
  type AnnotationSettings,
  type GlossScope,
} from '@/lib/annotationDisplay';
import { glossLanguageFor, hyperliteralApplies } from '@/lib/languages';

/**
 * `resolveAnnotationDisplay` is asked by two sides that must never disagree:
 * the client (what to render) and the content sweep (what to generate). These
 * pin the precedence and the two gates that made earlier versions wrong.
 */

/**
 * English gloss, with every language named below eligible for one. These cases
 * are about the settings rules, so the target-language gate is kept out of
 * their way; it has its own case at the bottom of `resolveAnnotationDisplay`.
 */
const EN: GlossScope = {
  language: 'en',
  appliesTo: ['ja', 'ko', 'ru', 'en', 'en_gb', 'de'],
};

describe('resolveAnnotationDisplay', () => {
  it('defaults romanization and furigana on, IPA and the gloss off', () => {
    const d = resolveAnnotationDisplay(undefined, 'ja', EN);
    expect(d.romanization).toBe(true);
    expect(d.furigana).toBe(true);
    // IPA stays opt-in: a specialist aid that should not appear unasked.
    expect(d.ipa).toBe(false);
    // So does the gloss, but for a different reason: it costs a model call per
    // sentence, so an existing course must never start buying them by having
    // said nothing. New courses carry an explicit `true` instead
    // (NEW_COURSE_SETTINGS_DEFAULTS), which the next case pins.
    expect(d.hyperliteral).toBe(false);
  });

  it('shows the gloss for a course carrying the stamped default', () => {
    const d = resolveAnnotationDisplay({ showHyperliteral: true }, 'ja', EN);
    expect(d.hyperliteral).toBe(true);
  });

  it('lets the course-wide switch turn a kind off', () => {
    const d = resolveAnnotationDisplay({ showHyperliteral: false }, 'ja', EN);
    expect(d.hyperliteral).toBe(false);
  });

  it('lets a per-language override beat the course switch, both ways', () => {
    const settings: AnnotationSettings = {
      showRomanization: true,
      showHyperliteral: false,
      annotationOverrides: {
        ko: { romanization: false },
        ja: { hyperliteral: true },
      },
    };
    expect(resolveAnnotationDisplay(settings, 'ko', EN).romanization).toBe(
      false,
    );
    expect(resolveAnnotationDisplay(settings, 'ja', EN).romanization).toBe(
      true,
    );
    expect(resolveAnnotationDisplay(settings, 'ja', EN).hyperliteral).toBe(
      true,
    );
    expect(resolveAnnotationDisplay(settings, 'ko', EN).hyperliteral).toBe(
      false,
    );
  });

  it('never resurrects an aid the language does not have', () => {
    // Furigana is Japanese-only, and an override is kept rather than cleared
    // when a language leaves the course (hide-don't-clear), so a stale one
    // must not switch a line on for a language that cannot produce it.
    const settings: AnnotationSettings = {
      annotationOverrides: { ko: { furigana: true, ipa: true } },
    };
    expect(resolveAnnotationDisplay(settings, 'ko', EN).furigana).toBe(false);
  });

  it('never glosses a language into itself', () => {
    const settings: AnnotationSettings = { showHyperliteral: true };
    expect(resolveAnnotationDisplay(settings, 'en', EN).hyperliteral).toBe(
      false,
    );
    expect(resolveAnnotationDisplay(settings, 'en_gb', EN).hyperliteral).toBe(
      false,
    );
    expect(resolveAnnotationDisplay(settings, 'ru', EN).hyperliteral).toBe(
      true,
    );
  });
});

describe('hyperliteralApplies', () => {
  it('collapses regional variants before comparing', () => {
    expect(hyperliteralApplies('en_us', 'en_gb')).toBe(false);
    expect(hyperliteralApplies('es_latam', 'es')).toBe(false);
    expect(hyperliteralApplies('ja', 'en')).toBe(true);
  });
});

describe('glossLanguageFor', () => {
  it('is English for every course, whatever the base language', () => {
    // Pinned for now (Paul, 2026-09-11). The parameter stays so that going
    // back to the learner's own base language is a one-function change.
    expect(glossLanguageFor({ baseLanguages: ['en_gb'] })).toBe('en');
    expect(glossLanguageFor({ baseLanguages: ['de', 'en'] })).toBe('en');
    expect(glossLanguageFor({ baseLanguages: [] })).toBe('en');
    expect(glossLanguageFor({})).toBe('en');
  });
});

describe('hyperliteralWantsFor', () => {
  const course = { baseLanguages: ['en'], targetLanguages: ['ja', 'ko'] };

  it('is undefined when the course wants no gloss, so nothing is generated', () => {
    expect(
      hyperliteralWantsFor(course, { showHyperliteral: false }),
    ).toBeUndefined();
  });

  it('wants nothing when the settings row says nothing', () => {
    // An old course, from before the feature. It must not start paying for
    // glosses just by staying silent.
    expect(hyperliteralWantsFor(course, undefined)).toBeUndefined();
    expect(hyperliteralWantsFor(course, {})).toBeUndefined();
  });

  it('lists every language the gloss is on for, and the gloss language', () => {
    const wants = hyperliteralWantsFor(course, { showHyperliteral: true });
    expect(wants?.glossLanguage).toBe('en');
    expect([...(wants?.languages ?? [])].sort()).toEqual(['ja', 'ko']);
  });

  it('honours a per-language exception', () => {
    const wants = hyperliteralWantsFor(course, {
      showHyperliteral: true,
      annotationOverrides: { ko: { hyperliteral: false } },
    });
    expect([...(wants?.languages ?? [])]).toEqual(['ja']);
  });

  it('can be on for one language while the course switch is off', () => {
    const wants = hyperliteralWantsFor(course, {
      showHyperliteral: false,
      annotationOverrides: { ja: { hyperliteral: true } },
    });
    expect([...(wants?.languages ?? [])]).toEqual(['ja']);
  });

  it('writes the gloss in English even on a non-English course', () => {
    const wants = hyperliteralWantsFor(
      { baseLanguages: ['de'], targetLanguages: ['ru'] },
      { showHyperliteral: true },
    );
    expect(wants?.glossLanguage).toBe('en');
    // German is the base language here, so it is not glossed even though it
    // differs from English.
    expect([...(wants?.languages ?? [])]).toEqual(['ru']);
  });
});

describe('annotationDisplayByLanguage', () => {
  it('resolves one entry per language', () => {
    const byLang = annotationDisplayByLanguage(
      {
        showRomanization: true,
        annotationOverrides: { ko: { romanization: false } },
      },
      ['ja', 'ko'],
      EN,
    );
    expect(byLang.ja.romanization).toBe(true);
    expect(byLang.ko.romanization).toBe(false);
  });
});

describe('annotationLinePropsFromSettings', () => {
  it('applies overrides without needing the gloss language', () => {
    const props = annotationLinePropsFromSettings(
      {
        showHyperliteral: true,
        annotationOverrides: { ja: { hyperliteral: false } },
      },
      'ja',
    );
    expect(props.showHyperliteral).toBe(false);
    expect(
      annotationLinePropsFromSettings({ showHyperliteral: true }, 'ja')
        .showHyperliteral,
    ).toBe(true);
  });
});
