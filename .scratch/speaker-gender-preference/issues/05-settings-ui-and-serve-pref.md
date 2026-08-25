# 05 — Settings UI + preference threading (feature goes live)

Status: ready-for-agent
Type: task
Blocked by: 04

Read `../spec.md` (Settings UI + i18n; Pipeline → threading; Kill switch).

## Scope
- `components/app/LearningModeSettings.tsx`: new section gated by
  `SPEAKER_GENDER_FEATURE_ENABLED && [...base,...target].some(languageMarksSpeakerGender)`
  (pattern `courseSupportsIpa` :51,270): 3-option radio Mixed (default,
  "varies per sentence") / Female / Male + scope note listing the course's
  marked languages ("applies to {names}; voices change for all languages").
  Write via `useUpdateCourseSettings`; read
  `courseSettings.speakerGenderPreference ?? 'mixed'`.
- On change: fire one `ensureUpcomingCardsContent` kick (decision 3 —
  upcoming-window regeneration).
- Thread the pref into serve + ensure paths: `getActiveCourseSettings`
  consumers → `buildTextContentBatchForLanguages` opts; `prepareCardContent`,
  `ensureCardContent`, `ensureUpcomingCardsContent(/AllModes)`,
  `scheduleContentForUpcomingCards`; serve callers `getDeckCards`,
  `getCardForReview`, library, stats, collections preview.
- i18n keys in `messages/en.json` + `messages/de.json` under
  `LearningMode.settingsPanel.*` (`speakerGender`, `…Description`, `…Mixed`,
  `…Female`, `…Male`, `…ScopeNote`).
- PostHog event `speaker_gender_preference_changed`.
- Changelog entry `changelog/unreleased/YYYY-MM-DD-speaker-gender.md`
  (end-user language, benefit first, no code jargon).

## Tests
- e2e (pattern `e2e/learning-settings.spec.ts`): section visible for
  es-target course, hidden for de-only; select Female → persists + ensure
  kick; Mixed restore.
- convex-test: serve returns the effective variant + paired audio;
  `hasMissingContent` gating (pinned upload + opposite pref → false).
- Manual script per spec (Testing → Manual).

## Done when
Feature works end-to-end on dev per the manual script; suites green; deployed.
