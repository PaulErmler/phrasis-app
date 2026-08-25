# 08 — Chat: generate in the chosen gender

Status: resolved
Type: task
Blocked by: 05, 07

Read `../spec.md` (Chat section; decisions 5, 8).

## Scope
- `convex/features/chat/promptSections.ts`: new
  `buildSpeakerGenderSection(courseLanguages, pref)` — emitted only when
  feature on ∧ pref ∈ {male, female} ∧ some course language is marked; names
  only the course's marked languages; instructs first-person sentences as a
  {gender} speaker (grammatical agreement / particles / self-reference per
  tier) without forcing gender where a sentence has none.
- `convex/features/chat/messages.ts`: `getCourseLanguagesForUser` (:110) also
  returns the pref; append the section to dynamicContextParts in both
  assembly sites (:418-421, :505-512). Static agent instructions
  (agent.ts:176) untouched (prefix cache).
- `convex/features/chat/cardApprovals.ts`: `createApprovalRequestInternal`
  (:214) records `generationSpeakerGender`; `processApproval` (:67) stamps
  inserted translation rows with explicit slots (generation gender on marked,
  `'neutral'` on unmarked) and passes `generationSpeakerGender` to
  `generateSentenceMetadata`.
- `convex/features/chat/approvalAudio.ts` (:59): preference-first gender
  candidates so the preview voice matches the eventual card voice.
- Chat cards pin at generation (decision 5) — no sweep changes here; the
  flippable variant stays a future decision-gated issue (10).

## Tests
convex-test: section emitted/omitted per gate; approval records + stamps +
threads the generation gender; approvalAudio candidate order; generated card
in a marked language pins via morphology (existing case-1 path).

## Done when
Suites green; manual: chat-created card's text + preview + final audio all
match the preference; deployed.

## Answer

Implemented in commit `61966f8` on `claude/gender-card-translation-plan-3vnuk5`; suites green (typecheck, convex + app vitest).
