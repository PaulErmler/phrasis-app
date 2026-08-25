# 01 — Language config + resolution layer

Status: resolved
Type: task

Zero behavior change. Read `../spec.md` first (sections: Language
classification, Architecture → Resolution layer).

## Scope
- `lib/languages.ts`: add **required** `speakerGenderMarking: 'grammatical' |
  'stylistic' | 'none'` to the `Language` interface (~:275) and stamp all 60
  entries per the spec's classification (29 grammatical / 5 stylistic / 26
  none). Derived helpers next to the IPA block (~:2386):
  `languageMarksSpeakerGender`, `getSpeakerGenderMarking`,
  `SPEAKER_GENDER_MARKING_LANGUAGES`. NO exported all-marking-names list.
- New `lib/speakerGender.ts`: `SPEAKER_GENDER_FEATURE_ENABLED` const,
  `SpeakerGenderPreference`/`TranslationGenderSlot` types,
  `resolveEffectiveSpeakerGender`, `courseMarksSpeakerGender`,
  `translationGenderSlot` (never returns undefined), `pickTranslationVariant`
  (tri-state tolerant rule per spec). Move the FNV-1a hash here; `lib/voices.ts`
  imports it (behavior identical).
- `lib/voices.ts`: doc-comment updates only (canonical layer).
- Re-export the new helpers from `lib/languages.ts` (:2550 block) for
  single-import ergonomics.

## Tests
- `tests/unit/lib/languages.test.ts`: field present on all 60 entries; derived
  set/predicates correct (model: IPA block :257-285).
- New `tests/unit/lib/speakerGender.test.ts`: resolver truth table
  (definitive × pref × canonical × kill switch), `pickTranslationVariant`
  (`'neutral'` satisfies both; legacy `undefined` = canonical carrier only;
  unmarked ignores stamps; opposite-gender display fallback), slot fn,
  FNV determinism unchanged.

## Done when
`tsc --noEmit`, lint, unit tests green; no runtime code path changed.

## Answer

Implemented in commit `2860ddc` on `claude/gender-card-translation-plan-3vnuk5`; suites green (typecheck, convex + app vitest).
