# 02 — Schema fields + validators

Status: ready-for-agent
Type: task
Blocked by: 01

Zero behavior change. Read `../spec.md` (section: Schema changes). Read
`convex/_generated/ai/guidelines.md` before touching schema.

## Scope
- `convex/types.ts`: new `translationGenderSlotValidator`
  (`'male'|'female'|'neutral'`, from `SPEAKER_GENDER_VALUES` :317); export the
  preference validator (`'male'|'female'|'mixed'`).
- `convex/schema.ts`:
  - `courseSettingsFields` (~:139, next to `showIpa`):
    `speakerGenderPreference` (3-literal union, optional). Verify it is NOT in
    the `coursePatchableSettingsValidator` omit list (auto-patchable).
  - `translations.speakerGender` (:495): widen to
    `translationGenderSlotValidator`.
  - `llmTranslationClaims` (:1186) + `ttsGenerationClaims` (:1165): add
    optional `speakerGender` (slot validator resp. `voiceGenderValidator`).
    No index changes.
  - `cardApprovals`: add optional `generationSpeakerGender`
    (`voiceGenderValidator`).
  - Doc-comment rewrites per spec (`texts.audioSpeakerGender` = canonical
    mixed default; `translations.speakerGender` = tri-state variant stamp;
    `audioRecordings` = one row per (text, language, asset-gender)).
- Explicitly NO new indexes (spec rationale: tolerant reads need all ≤3 rows
  anyway; avoids staged-index sequencing).

## Done when
`tsc --noEmit` + convex codegen clean; deploy dry-run passes; no behavior
change (fields unused until later slices).
