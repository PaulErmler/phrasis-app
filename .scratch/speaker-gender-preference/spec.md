# Spec: User-selectable speaker gender for cards, audio & chat

Status: ready-for-agent

Base branch: `development` (planned against HEAD `ceefd37`).
Issues: `issues/NN-*.md` in this directory, one per implementation slice, in
order. Board card for Paul to add (board symlink absent in remote sessions):
`- [ ] Speaker gender preference (cards/audio/chat) — .scratch/speaker-gender-preference/ #ready-for-agent`

Before any Convex code is written, the implementer MUST read
`convex/_generated/ai/guidelines.md` (per CLAUDE.md).

## Context

Phrasis teaches languages through sentence cards with LLM translations and
on-demand TTS. In many languages the *speaker's* gender changes the sentence
itself (Spanish "estoy cansado/cansada", Russian past tense "я сказал/сказала",
Hebrew present-tense verbs, Thai ครับ/ค่ะ). Today every text gets a
deterministic ~50/50 coin-flip gender (seeded FNV-1a on the text `_id`,
`lib/voices.ts:376`) — a female learner can spend months drilling forms she
would never say.

The feature: a per-course preference **Male / Female / Mixed** (default Mixed =
exactly today's behavior). Male/Female pins the sentence grammar (only where
the language marks it) and the TTS voice gender (everywhere). Chat generates in
the chosen gender. User-uploaded sentences keep their inherent, auto-detected
gender — user content is never rewritten. The feature must be cleanly
switch-off-able later (everyone reverts to Mixed, no data loss).

**Load-bearing facts about the current code:** development already has most of
the machinery — per-text gender metadata, gender-stamped translations,
gender-keyed content-addressed audio assets, gender-aware translation prompts,
and a (destructive) gender-drift regeneration sweep. What's missing: a
per-language config flag, the user preference, and a per-user resolution
layer. The core constraint: `texts`/`translations`/`audioRecordings`/
`audioAssets` are **globally shared across users** — the preference must never
be written into shared rows, or users would fight over them and trigger
regeneration storms.

## Decisions (confirmed with Paul)

1. **Single 3-way setting** — Male / Female / Mixed; one choice drives grammar
   + voice. (A separate voice preference could be added later, no migration.)
2. **Stored per course** in `courseSettings` (house pattern; consumers are
   course-scoped). New courses start Mixed.
3. **Lazy regeneration + upcoming-window kick** — on switch, one
   `ensureUpcomingCardsContent`-style call regenerates the next cards; the rest
   as cards get prepared. Both gender variants stay cached → later flips free.
4. **Settings sheet only in v1** — no onboarding step (documented as a future
   slice).
5. **Chat cards pin at generation** — generated in the chosen gender; a later
   switch does not rewrite them (morphology-based pinning does this naturally;
   the "flippable chat cards" variant is documented as a future decision-gated
   slice — it conflicts with the provenance doctrine in
   `lib/translationProvenance.ts:99-103` and must not ship partially).
6. **Custom/entered cards: keep automatic inference** (Paul's explicit choice).
   The metadata LLM already detects a sentence's gender from morphology and the
   voice already matches it (`sentenceMetadata.ts` + `resolveCardSpeakerGenders`
   case 1). Do NOT steer autofill generation by the preference. The preference
   only decides the voice where inference finds nothing (truly neutral
   sentences).
7. **Stylistic-tier languages get full text variants** (Thai ครับ/ค่ะ is where
   this matters most), same machinery as grammatical ones.

**Review adjustments (Paul, on plan review):**

8. **No global language lists in prompts.** Whether gender matters lives ONLY
   in the language config; every prompt is assembled per call from the
   languages actually involved and consults their config flags. No prompt ever
   embeds "the list of all gender-marking languages".
9. **No `undefined` with meaning.** The config field is required with an
   explicit `'none'`; the translation gender stamp is an explicit tri-state
   (`'male' | 'female' | 'neutral'`, where `'neutral'` = valid for both
   genders). `undefined` is permitted only as "legacy row written before this
   feature" and is never written going forward.
10. **Audio regeneration affects only the current (effective) gender's audio**;
    the other variant's cached audio is untouched.
11. **A translation flag flags the (text, language) pair** — all gender
    variants of that translation get flagged and retranslated, not just the
    one the flagging user saw.
12. **Gold eval dataset**: curate a source-verified dataset of gendered
    sentences (10–50 per marked language, only 100%-certain entries) to
    measure metadata-classifier accuracy across languages, before and after
    the prompt change.

## Language classification → new config

New **required** field on `Language` (`lib/languages.ts:78-289`; deliberately
NOT the IPA presence-as-flag pattern, per decision 9 — every language makes an
explicit choice, like the required `needsRomanization`):

```ts
speakerGenderMarking: 'grammatical' | 'stylistic' | 'none'
```

- `'grammatical'` (first-person morphology changes audibly): `es`, `es_latam`,
  `es_mixed`, `pt`, `pt_pt`, `it`, `fr`, `ca`, `ro`, `el`, `ru`, `uk`, `pl`,
  `cs`, `sk`, `hr`, `sr`, `sl`, `bg`, `lt`, `lv`, `is`, `hi`, `he`, `ar`,
  `ar_sa`, `ar_eg`, `ar_iq`, `ar_lev` (29 entries)
- `'stylistic'` (speaker-gender-linked particles/pronouns/register): `ja`,
  `th`, `vi`, `vi_south`, `ko` (5 entries)
- `'none'`: `en`, `en_gb`, `en_us`, `en_au`, `de`, `nl`, `sv`, `nb`, `da`,
  `fi`, `et`, `hu`, `tr`, `fa`, `sw`, `sw_tz`, `id`, `ms`, `fil`, `zh`,
  `zh_traditional`, `yue`, `yue_traditional`, `bn`, `ta`, `te` (26 entries;
  Bengali/Tamil/Telugu: 1st-person verbs are gender-neutral; German et al.:
  predicative adjectives don't inflect — role nouns only)

Derived helpers next to the IPA block (`lib/languages.ts:2386-2409`):
`languageMarksSpeakerGender(code)` (= marking !== 'none'),
`getSpeakerGenderMarking(code)`, `SPEAKER_GENDER_MARKING_LANGUAGES` set.
NO exported "all marking language names" list (decision 8) — prompt builders
take the languages of the current request and filter them through the
predicate. Unit test mirrors the IPA block
(`tests/unit/lib/languages.test.ts:257-285`) and asserts the field is present
on all 60 entries.

## Architecture

The shared content layer becomes **variant-additive**; every consumer resolves
an **effective speaker gender** per (text, user) at read/schedule time.

- `texts.audioSpeakerGender` is re-documented as the **canonical (mixed-mode)
  default** — exactly what exists today. The preference is an overlay, never
  written to `texts.*`.
- `translations.speakerGender` (schema.ts:495) is promoted from drift-detector
  to **explicit variant stamp** with tri-state semantics (decision 9):
  - `'male'` / `'female'`: this rendering was produced for that speaker gender
    (only ever written for marked languages);
  - `'neutral'`: this rendering is valid for BOTH genders — always written for
    unmarked languages, and written on marked-language rows when **variant
    collapse** (below) proves the sentence gender-invariant;
  - `undefined`: legacy row from before this feature (incl. seed pipeline,
    `convex/db/translationSeed.ts:27`) — read-tolerated, never written.
  Up to one row per gender per `(textId, targetLanguage)`; a `'neutral'` row
  satisfies both. Rows are never deleted on gender grounds anymore.
- **Variant collapse:** when a newly generated variant's `translatedText`
  equals the existing sibling's text, do NOT insert a duplicate — re-stamp the
  sibling `'neutral'`. Most dataset sentences are third-person/descriptive
  (13,734 of 20,642 OGTE rows), so most marked-language cards converge
  permanently to a single shared row after at most one extra LLM run. This is
  what implements "only for sentences where it actually matters" per sentence.
- Audio already variant-capable: `audioAssets` content-addressed by
  `voiceGender` (schema.ts:521-583); `audioRecordings` pointer rows become
  ≤1-per-gender per (text, language). Flip-back is free on both layers (audio
  already `keepAsset`s on gender changes; translation variants now persist).
- The destructive gender-drift sweep (`decks.ts:533-700`: `genderMismatch`
  audio deletes + `isDrifted`/`isLegacyAlongsideDriftedAudio` translation
  deletes) is **replaced** by a non-destructive "ensure the effective variant
  exists" sweep.

### Resolution layer — new file `lib/speakerGender.ts` (pure, client-safe)

```ts
export const SPEAKER_GENDER_FEATURE_ENABLED = true;  // kill switch

export type SpeakerGenderPreference = 'male' | 'female' | 'mixed';
export type TranslationGenderSlot = 'male' | 'female' | 'neutral';

// definitive text gender wins (pin rule) → else preference → else canonical
// (stored audioSpeakerGender ?? FNV-1a(seed)). Kill switch off ⇒ canonical.
export function resolveEffectiveSpeakerGender(
  text: { speakerGender?: string; audioSpeakerGender?: string; userCreated: boolean },
  seed: string,
  preference: SpeakerGenderPreference | undefined,
): 'male' | 'female';

// UI/chat gate: any course language (base ∪ target) marked?
export function courseMarksSpeakerGender(base: string[], target: string[]): boolean;

// the slot a write for this (language, effective gender) occupies:
// marked language → the gender; unmarked → 'neutral'. NEVER undefined.
export function translationGenderSlot(lang: string, g: 'male'|'female'): TranslationGenderSlot;

// tolerant multi-row pick:
// unmarked lang → any row (prefer 'neutral'/legacy-undefined);
// marked lang → row stamped g → row stamped 'neutral' → legacy undefined row
//   (canonical carrier: satisfies only the canonical gender) → any other row
//   (opposite gender, display fallback so a card is never blank while its
//   variant generates)
export function pickTranslationVariant<T extends {speakerGender?: string}>(
  rows: T[], lang: string, g: 'male'|'female',
  canonical: 'male'|'female'): { row: T | null; satisfied: boolean };
```

Move the FNV-1a hash here; `lib/voices.ts` consumes it.
`resolveCardSpeakerGenders`/`resolveAudioSpeakerGender` stay **unchanged** as
the canonical layer (doc comments updated). Two axes fall out of one effective
gender: **voice** applies to all languages; **translation variants** only where
the language is marked. "Ensure satisfied" means: a row stamped with the
effective gender or `'neutral'` exists (legacy `undefined` satisfies only the
canonical gender). `pickAudioVariant(payloads, g)` (exact gender + spokenText
matches served variant → gender match → any) lives in
`convex/lib/audioAssets.ts`. New provenance predicate
`mayAddTranslationVariant(text, row)` in `lib/translationProvenance.ts`:
premade text + machine row → true; human-authored row or user-created text →
false (v1; the chat-flippable future slice would carve out chat-machine rows).

## Schema changes (`convex/schema.ts`) — no new indexes, no staged rollout

- `courseSettingsFields` (~:139, next to `showIpa`):
  `speakerGenderPreference: v.optional(v.union(v.literal('male'), v.literal('female'), v.literal('mixed')))`.
  The explicit `'mixed'` literal is required — `updateCourseSettings`
  (courses.ts:1097) skips undefined args, so a 2-literal field could never
  switch *back* to mixed. `undefined` here means only "never set" (standard
  optional-setting pattern) and behaves as Mixed. Auto-patchable via
  `coursePatchableSettingsValidator` (schema.ts:243).
- `translations.speakerGender`: widen validator from `voiceGenderValidator` to
  a new `translationGenderSlotValidator` (`'male'|'female'|'neutral'`, built
  from `SPEAKER_GENDER_VALUES`, `convex/types.ts:317`).
- `llmTranslationClaims` + `ttsGenerationClaims` (schema.ts:1165/1186): add
  `speakerGender: v.optional(translationGenderSlotValidator /* resp. voiceGenderValidator for TTS */)`
  — claims store the slot being generated (translation: male/female/neutral;
  TTS: the voice gender male/female). `undefined` = legacy in-flight claim
  from the deploy boundary only; it conservatively blocks all slots and drains
  within `CLAIM_STALE_MS` (10 min). No index change — claims are point-read
  via `by_text_and_language` and filtered in memory (≤3 rows/key).
- `cardApprovals`: `generationSpeakerGender: v.optional(voiceGenderValidator)`
  — the preference in force when chat generated the proposal (optional =
  "generated without a preference", not a semantic third state).
- Doc-comment rewrites (no data change): `texts.audioSpeakerGender` = canonical
  mixed default; `translations.speakerGender` = tri-state variant stamp;
  `audioRecordings` = one row per (text, language, asset-gender).
- **Deliberately no** `(textId, targetLanguage, speakerGender)` index and no
  gendered `audioRecordings` index: every consumer needs all variants anyway
  for the tolerant fallback; cardinality per key ≤3. Read via existing indexes
  with `.take(4)` + pick in JS. This removes all staged-index deploy
  sequencing; indexes can be added later additively if ever needed.
- Migration (hygiene, non-blocking): `stampNeutralOnUnmarkedTranslations` —
  set `speakerGender: 'neutral'` on every translations row whose
  `targetLanguage` has marking `'none'` (whatever it held before). Via
  `@convex-dev/migrations` (`convex/migrations.ts`, append to `runAll`), plus
  `docs/migrations/stamp-neutral-unmarked-translations.md` with a
  `Status: **NOT yet run**` line (model:
  `docs/migrations/per-mode-settings-backfill.md`). Marked-language legacy
  rows stay `undefined` and heal lazily (fill-if-missing stamps the canonical
  gender; variant collapse may re-stamp `'neutral'`).
- Everything else needs **no migration** (new fields optional; variants
  created lazily).

## Changes by area

### Pipeline (`convex/features/decks.ts` and friends)

- Thread `speakerGenderPreference` as an optional arg through
  `prepareCardContent` (:2463), `ensureCardContent` (:2210),
  `ensureUpcomingCardsContent(/AllModes)` (:2367/:2415),
  `scheduleContentForUpcomingCards` (:2308), `scheduleMissingContent` (:405).
  Warmups/admin callers pass nothing → canonical. A stale pref in an
  already-scheduled job is harmless (output is a cached variant; next pass
  corrects).
- **`scheduleMissingContent` rewrite** (the heart of the change):
  1. Keep `resolveCardSpeakerGenders` + `genderPatch` (canonical bookkeeping).
  2. `effectiveGender = resolveEffectiveSpeakerGender(text, textId, pref)`.
  3. Reads go `.first()` → `.take(4)` per language (translations + audio).
  4. Audio validity loop (:533-614): iterate all pointer rows; keep
     dangling/blob-missing/provider/ttsVersion deletes; **delete the
     `genderMismatch` branch** — an other-gender row is a kept variant.
     "Audio present" now means: a row whose asset gender == effectiveGender AND
     whose `spokenText` equals the effective translation variant's text.
  5. Translation block (:616-700) becomes **ensure-variant**: per marked
     language, `pickTranslationVariant`; if not satisfied and
     `mayAddTranslationVariant` allows → enqueue generation for
     `translationGenderSlot(lang, effectiveGender)`; never delete siblings.
     Remove `langsWithAudioGenderDrift`, `isDrifted`,
     `isLegacyAlongsideDriftedAudio`. `isTranslationVersionStale` applies to
     the **effective row only** (delete+regen as today, provenance-gated,
     `sweptRegionVariants` kept); a sibling regenerates when it next becomes
     effective. Unmarked languages: exactly today's logic, slot `'neutral'`.
  6. **regionVariant pinning (es_mixed):** a new gender variant inherits the
     sibling/legacy row's `regionVariant` so both genders keep one dialect.
  7. Probe mode (`ProbeNeedsWork`, :152): mirror every new would-write branch;
     an in-flight claim for the same slot counts as handled, another slot's
     claim does not block.
- **`storeTranslationAndScheduleTTS`** (:2710): existing-row lookup becomes
  slot lookup (`.take(4)`): match the incoming slot, where a legacy
  `undefined` row counts as the canonical-gender slot (marked) or `'neutral'`
  slot (unmarked) — fill-if-missing then stamps it with that explicit value
  (today's :3006 behavior, now always writing an explicit value). Insert path
  stamps `translationGenderSlot(...)` — **never undefined**. Before inserting
  a marked-language variant: **collapse check** — if `translatedText` equals
  the sibling row's text, patch the sibling to `'neutral'` instead of
  inserting. Flag-retranslation `replaceExisting` stays per-row; its audio
  delete narrows to pointer rows of that row's gender (marked languages);
  a retranslated `'neutral'` row is regenerated under the requesting slot's
  gender and re-collapses on store if still invariant. Trailing TTS check
  becomes gender-aware. `expectedClaimId` single-writer token unchanged.
- **Claims** (`llmTranslationQueue.ts:79-185`, `ttsProcessing.ts:105-214`):
  claim helpers gain a slot param, stored on insert, matched on read (legacy
  `undefined` claim = blocks all slots). Takeover semantics per slot
  unchanged. Enqueue args + completion contexts carry the slot so the right
  claim is released.
- **`upsertAudioPointer`** (`convex/lib/audioAssets.ts:186`): match the
  existing row whose pointed asset has the same `voiceGender` as the new asset
  (one extra `ctx.db.get`); insert a second row otherwise. GC/refcount via
  `by_assetId` unchanged. Fix two `.first()` row-locates in
  `ttsProcessing.ts` (`updateAudioRecordingQuality` :679,
  `persistBackfilledWordTimings` :842) to find the row by asset match.
- **Serve path** (`convex/lib/cardContent.ts`): `buildTextContentBatchForLanguages`
  gains pref + text gender fields; translations/audio reads `.take(4)` +
  variant pickers with progressive fallback (card never blank).
  `hasMissingContent` adds two terms, both **generatable-gated**
  (missing variant counts only when `mayAddTranslationVariant` allows;
  pinned upload + opposite pref must yield `false` — regression test).
  Replace the `.unique()` at :375 (`buildCardSearchableText`) with `.take(4)`
  + canonical pick, deliberately preference-independent. Thread pref through
  all serve callers: `getDeckCards` (decks.ts:860), `getCardForReview`
  (scheduling.ts:224), library.ts:352, stats.ts:562, collections.ts:251.
- **Preview**: `requestPreviewAudio`/`scheduleMissingTranslationsForText`
  (collections.ts:634/~420) resolve the caller's pref.
- **`regenerateCardAudio`** (scheduling.ts:1820), per decision 10: delete and
  re-synthesize ONLY pointer rows whose asset gender == effectiveGender (per
  language); the other variant's cached audio is untouched. `forceAudioRegen`
  bypasses the asset cache for that gender only.
- **`flagTranslation`** (scheduling.ts:1690), per decision 11: a flag applies
  to the (text, language) pair. Fetch `.take(4)`; bump `flagCount` on ALL
  variant rows; enqueue auto-retranslation for **each existing variant row**
  at its own slot (the effective row at the caller's priority, siblings
  `background`), each gated by `FLAG_AUTO_RETRANSLATION_MAX` per row; 3+ =
  triage-only as today. A single `'neutral'` row = one bump + one
  retranslation (re-collapse on store).
- Placement test / onboarding first lesson: canonical everywhere via a small
  `getCanonicalTranslation` helper (no settings context yet) — documented as
  intentional. Offline `batchUpsertTranslations` (`convex/db/translationSeed.ts`)
  switches to canonical-slot lookup, stamps explicit slots on write, and drops
  sibling variants when wording changes (stale renderings of old wording).
- Chat `cardContext.ts:49`: display the canonical row per language (don't show
  the model two Spanish lines).

### Prompts — per-call, config-driven, no global lists (decision 8)

- **Translation** (`convex/features/translationLLM.ts`): `buildContextLines`
  (:186) emits `<speaker_gender>` **only when
  `languageMarksSpeakerGender(targetLanguage)`**; unmarked targets get neither
  the tag nor the agreement instruction (prompt shrinks). The
  `PROMPT_B_INSTRUCTIONS` (:107) speaker-gender sentence moves into a
  conditional fragment phrased per tier: grammatical → "use it for
  morphological agreement (first-person verb forms, predicate adjectives)";
  stylistic → "use it for speaker-linked particles, self-reference pronouns
  and register". `<referent_gender>`/`<addressee_gender>`/`<register>` are
  different axes and stay unchanged for all languages.
- **Metadata classifier** (`convex/features/sentenceMetadata.ts`): replace the
  hardcoded prose list (:45-50, and the sibling copy in `customTexts.ts:101`)
  with a per-request builder: given the languages present in THIS request,
  name only those whose config marks gender ("of the languages in this
  request, X and Y mark speaker gender — detect `speakerGender` from their
  morphology; the other languages cannot express it"). If none of the
  request's languages is marked, the instruction reduces to "return neutral".
  Unit-test: prompt contains exactly the marked subset of the request's
  languages, and changing a language's config changes the prompt.
- **Chat** (`convex/features/chat/promptSections.ts`): new
  `buildSpeakerGenderSection(courseLanguages, pref)`, emitted only when
  feature on ∧ pref ∈ {male, female} ∧ some course language is marked; it
  names only the **course's** marked languages (already per-call data — no
  global list) and instructs first-person sentences as a {gender} speaker,
  without forcing gender where a sentence has none.

### Metadata (`convex/features/sentenceMetadata.ts`)

- Prompt: per-request builder (above).
- `applyTextMetadata` ladder (:410-427) gains one rung:
  LLM definitive → prior row → **`generationSpeakerGender`** (chat only) →
  seeded flip. Fix in passing: the fallback flip at :427 is seedless
  (`Math.random`) — pass `textId` (removes a documented race class,
  `lib/voices.ts:360-375`).
- Translation-stamping loop (:514-526): stamp explicit slots — the resolved
  gender on marked languages, `'neutral'` on unmarked.
- Custom texts thread **no** preference (decision 6: inference pins; neutral
  sentences get their voice from the serve-time resolver).

### Classifier gold dataset & accuracy eval (decision 12)

A curated gold-standard dataset of sentences with **known, verified**
speaker-gender readings, to measure the metadata classifier's accuracy across
languages — baseline on today's prompt before the per-request prompt change,
re-run after it, and on any future classifier prompt/model change.

- **Location & format**: `data_preparation/gender_eval/` (sibling of the
  existing `data_preparation/translation_eval/`): `data/<languageCode>.jsonl`,
  one record per sentence:
  `{ language, text, expected: 'male'|'female'|'neutral', phenomenon, glossEn, sourceUrl, notes? }`
  where `phenomenon` tags the marker (`past-tense-verb`,
  `predicate-adjective`, `participle`, `polite-particle`, `pronoun`,
  `verb-agreement`, `none-third-person`, `addressee-not-speaker`, …). A README
  documents the schema and curation rules.
- **Coverage**: 10–50 sentences per marked language (the 34 = 29 grammatical +
  5 stylistic), each set spanning: definitive male, definitive female,
  neutral-despite-marked-language (third-person/descriptive), and confusion
  edge cases — addressee gender ≠ speaker gender (ru "ты сказала…" marks the
  *addressee*), referent gender ≠ speaker gender, quoted speech, politeness
  particles per speaker gender (th ครับ/ค่ะ), gendered self-reference pronouns
  (ja 僕/あたし), audible vs written-only agreement (fr "contente" vs
  "fatiguée"), pt obrigado/obrigada. Dialect variants share the base file
  where the phenomenon is identical (es_latam ← es) and add variant-specific
  entries where dialects differ (Arabic dialect verb forms). Plus small
  negative-control sets (5–10) for major unmarked languages (en, de, zh, tr,
  fi, id) that must classify `neutral`.
- **Sourcing & the 100% bar**: sentences taken from authoritative reference
  websites (reference grammars, Wiktionary inflection tables, established
  grammar-reference sites), with `sourceUrl` recorded per entry and the exact
  morphological marker named. Verification protocol: every entry is checked
  against its cited source AND by two independent LLM cross-checks; any entry
  with any disagreement or ambiguity is DROPPED — fewer verified sentences
  beat more uncertain ones (explicit instruction: include only what is 100%
  certain). If a language yields fewer than 10 airtight entries, ship fewer
  and note the gap in the README rather than padding with uncertain ones.
- **Runner**: `scripts/evalSentenceMetadata.mjs` (pattern:
  `scripts/updateTranslations.mjs`) — imports the real prompt builder exported
  from `convex/features/sentenceMetadata.ts` (single source of truth), calls
  OpenRouter with the production classifier model, and writes
  `data_preparation/gender_eval/reports/<date>.md` with per-language accuracy,
  per-class precision/recall, and the list of misclassified sentences. Run
  on demand (API cost) — not part of CI.
- **Use**: languages scoring below ~90% get targeted per-language prompt
  notes (the existing `translationPromptNotes` pattern) and a re-run; the
  before/after comparison ships in the metadata slice's PR description.

### Chat (`convex/features/chat/`)

- `buildSpeakerGenderSection` (above), assembled next to
  `buildLanguageSection` in `messages.ts` (:418-421, :505-512); static agent
  instructions (agent.ts:176) untouched (prefix-cache preserved).
  `getCourseLanguagesForUser` (messages.ts:110) also returns the pref.
- `createApprovalRequestInternal` (cardApprovals.ts:214) records
  `generationSpeakerGender`; `processApproval` (:67) stamps inserted
  translation rows with explicit slots (generation gender on marked
  languages, `'neutral'` on unmarked) and passes `generationSpeakerGender` to
  `generateSentenceMetadata`.
- `approvalAudio.ts:59` `approvalGenderCandidates` becomes preference-first
  (preview voice matches the eventual card voice).
- `createMarkAlsoCorrectTool` (agent.ts:123) already carries
  `metadata.speakerGender` → inherits the new ladder unchanged.

### Custom texts (`convex/features/customTexts.ts`)

- Flow unchanged (decision 6). `createCustomText` (:452) inline resolution
  (:504-506): detected definitive → pin; else canonical seeded flip (voice
  follows pref at serve time via the resolver — nothing stored). Bulk import
  (:578) unchanged; morphology detection pins, provenance already protects
  user-provided rows from any rewrite. All translation stamps written here
  use explicit slots.

### Settings UI + i18n

- `components/app/LearningModeSettings.tsx`: gate
  `SPEAKER_GENDER_FEATURE_ENABLED && [...base,...target].some(languageMarksSpeakerGender)`
  (pattern: `courseSupportsIpa` :51,270). New section (own `<Separator/>`,
  near audio settings): 3-option radio (Mixed default "varies per sentence" /
  Female / Male) + a scope note listing the course's marked languages
  ("applies to {names}; voices change for all languages"). Write via
  `useUpdateCourseSettings` (optimistic — works automatically once the schema
  field exists). Read: `courseSettings.speakerGenderPreference ?? 'mixed'`.
- On change: fire one `ensureUpcomingCardsContent` kick (decision 3).
- i18n: `messages/{en,de}.json` under `LearningMode.settingsPanel.*`
  (`speakerGender`, `…Description`, `…Mixed`, `…Female`, `…Male`,
  `…ScopeNote`).

### Kill switch

`SPEAKER_GENDER_FEATURE_ENABLED` const in `lib/speakerGender.ts` (house
pattern; no remote-flag system exists — flip + deploy). Gate points:
(1) `resolveEffectiveSpeakerGender` → canonical when off (single choke point
for sweep/serve/preview/regen/flag/approval); (2) `courseMarksSpeakerGender`
→ false hides the settings section; (3) `buildSpeakerGenderSection` → absent;
(4) metadata `generationSpeakerGender` rung skipped. Off-state: stored prefs
retained but inert; variant rows/assets remain (`'neutral'` rows serve
everyone, gendered rows serve only when they match canonical); sweeps ensure
canonical only = today; no deletes → re-enable lossless; new users see no
setting → Mixed. Add a test that off ≡ baseline.

## Simplifications of the existing gender architecture (Paul's request)

**Do now (net deletion / cost win):**
1. Delete the translations gender-drift sweep + `langsWithAudioGenderDrift` +
   `isLegacyAlongsideDriftedAudio` heuristic (decks.ts:527-700) — replaced by
   ensure-variant; voice/text agreement becomes structural (variant pairing).
2. Stop gender-sweeping unmarked languages. Today any `audioSpeakerGender`
   flip (e.g. metadata LLM overriding the preview coin-flip on ~50% of
   gendered chat/custom cards) deletes and re-LLM-translates **every** course
   language incl. German/Turkish/Chinese rows that cannot differ, plus
   re-synth. Up to 2 wasted LLM + 2 wasted TTS calls per affected card in a
   3-language course — this stops entirely (`'neutral'` rows are
   gender-independent by definition).
3. Per-call, config-driven prompts (kills the two drift-prone hardcoded prose
   language lists; unmarked targets lose the pointless `<speaker_gender>` tag).
4. `stampNeutralOnUnmarkedTranslations` migration (retires meaningless stamps;
   after it, every unmarked-language row is explicitly `'neutral'`).
5. Seed the `applyTextMetadata` fallback flip with `textId`.
6. Variant collapse keeps the variant space minimal: invariant sentences
   converge to a single `'neutral'` row instead of duplicating forever.

**Document-only (churn > value — verified):**
- `texts.audioSpeakerGender` is NOT derivable/droppable: several writers used
  the seedless `Math.random` path and definitive-metadata overrides make it
  state, not a function of `_id`. Keep; re-document as "canonical default".
- Don't merge `texts.speakerGender` + `audioSpeakerGender`: ternary verdict vs
  binary assignment; `neutral` is load-bearing for the pin rule.
- Leave the loose `v.string()` gender fields on `texts` loose for now (offline
  seed pipeline writes them); new/changed fields use strict validators; note a
  future narrowing migration.

## Cost & storage

- Per switch (course: B base + T target languages, M marked): ≤M LLM
  translation runs per card (default rule `luna_bo3` = 3 candidates + judge,
  `lib/languages.ts:2050`) + one TTS synth per language at the new gender —
  each only on cache miss, only as cards come up (lookahead window first), and
  only until collapse: a gender-invariant sentence costs one extra run once,
  then is `'neutral'` forever.
- Flip-back: $0 (variant rows persist; assets already kept via `keepAsset`).
- Steady-state bound: ≤2 translation rows per (text × marked language) with
  most collapsing to 1 `'neutral'` row (13.7k of 20.6k dataset sentences are
  descriptive register); ≤2 audio pointers/assets per (text × language). No
  unbounded axis.
- Version bumps (`translationVersion`/`ttsVersion`) now cost up to 2× on
  marked languages for genuinely gendered flipped cards — bounded, lazy.
- Flag retranslation now covers all variants of a flagged (text, language)
  (decision 11) — at most one extra background LLM run per flag on a
  two-variant card; capped per row by `FLAG_AUTO_RETRANSLATION_MAX`.
- No quota needed in v1: expensive ops sit behind existing pools/claims (abuse
  degrades to slowness, not spend spikes). Add a PostHog event
  `speaker_gender_preference_changed`; revisit `FEATURE_IDS` if telemetry
  shows toggle-farming.
- Offset: simplification #2 removes today's wasted unmarked-language
  regenerations.

## Edge cases (each carries a test or an explicit note)

- **Deploy order is the one hard constraint:** variant-tolerant reads
  (`.unique()`/`.first()` audit) must be fully deployed before any writer can
  create a second row per (text, language) — `cardContent.ts:375` `.unique()`
  throws on duplicates.
- Legacy `undefined` rows on marked languages = canonical carrier; healed to
  explicit stamps by fill-if-missing (canonical gender) or collapse
  (`'neutral'`) — never stamped with the preference.
- Collapse race: two slots generating concurrently could both see "no sibling"
  — claims are per-slot so both may store; acceptable (two identical rows with
  different stamps is semantically fine); next ensure pass may collapse them.
  Store-side collapse re-checks inside the mutation (transactional), so the
  common path converges.
- es_mixed: variants share `regionVariant`; asset key already includes it.
- Two users, opposite prefs, same text: distinct claim rows / translation rows
  / assets — no OCC conflict; the only shared write (`genderPatch`) is an
  idempotent no-op the second time.
- Concurrent pref change mid-generation: the stale job writes its slot-keyed
  variant (becomes cache); next ensure pass generates the new one.
- Pinned upload + opposite pref: no variant generated, voice = pinned gender,
  `hasMissingContent === false` (no self-heal loop).
- flagCount: bumped on all variant rows (decision 11); admin triage displays
  the stamp.
- Warmups/placement/first-lesson: canonical (no pref context) — intentional.
- Source text is never variant-ized; dataset pivot is `en` (unmarked) so
  nothing arises; marked-language custom sources are user content = pinned.

## Testing & verification

- **Unit** (`tests/unit/lib/`): classification present on all 60 codes;
  `speakerGender.test.ts` truth table (definitive × pref × canonical × kill
  switch), `pickTranslationVariant` (tri-state incl. `'neutral'` satisfies
  both, legacy-undefined = canonical carrier, unmarked ignores stamps), slot
  fn never returns undefined, seeded-fallback determinism; voices
  gender-within-locale.
- **convex-test** (`convex/tests/features/`): ensure-variant sweep (pref=female
  on premade male-canonical text → additive female row + audio, male row
  untouched; flip back → zero writes / clean probe); **variant collapse**
  (identical output → sibling re-stamped `'neutral'`, no dup row; both genders
  then satisfied with zero further writes); unmarked languages stamped
  `'neutral'`, never regenerated on gender grounds; pinned custom text ignores
  pref; version-stale hits effective row only; parallel opposite-slot claims
  coexist, legacy genderless claim blocks all; slot upsert (legacy undefined
  row claims canonical slot, no dup insert); **flagTranslation bumps all
  variant rows and retranslates each slot**; **regenerateCardAudio deletes
  only effective-gender pointers**; serve picks variant + paired audio;
  `hasMissingContent` gating; prompt builders (translation prompt omits
  `<speaker_gender>` for unmarked targets; metadata prompt names exactly the
  request's marked languages); chat `generationSpeakerGender`
  recorded/stamped/threaded; approvalAudio pref-first; kill-switch-off ≡
  baseline snapshots.
- **e2e** (Playwright, pattern `e2e/learning-settings.spec.ts`): section
  visible for an es-target course, hidden for de-only; select Female →
  setting persists + ensure kick fires; Mixed restore.
- **Manual script**: dev deploy → en→es+de course → note a card's Spanish
  text/voice → set Female → confirm es text regenerates, de byte-identical,
  all audio female → flip Male → confirm cached after first pass → upload
  "Estoy cansada" → set Male → text + female voice unchanged → chat-create a
  card → proposal audio + approved card follow pref → flag a translation and
  confirm both variants retranslate → run the migration on dev and
  spot-check.
- **Classifier accuracy eval**: `scripts/evalSentenceMetadata.mjs` against the
  gold dataset — baseline before the prompt change (issue 06), comparison
  after (issue 07), re-run on any future classifier prompt/model change.
- Per slice: `tsc --noEmit`, lint, vitest + convex-test suites green before
  push (check `package.json` for the exact script names).

## Implementation order

One issue file per slice under `issues/`; each slice independently deployable.
No staged-index steps needed anywhere.

1. `01-language-config-and-resolver` — zero behavior change
2. `02-schema-and-validators` — zero behavior change
3. `03-variant-tolerant-reads` — behavior-neutral; **must soak in prod before 04**
4. `04-pipeline-ensure-variant` — user-invisible; drift sweep deleted (cost win)
5. `05-settings-ui-and-serve-pref` — **feature live**; changelog entry
6. `06-classifier-gold-dataset` — dataset + runner + baseline report
7. `07-metadata-per-request-prompts` — incl. eval before/after comparison
8. `08-chat-generation`
9. `09-cleanup-migration`

Future (documented, not in v1): `10-chat-flippable-variants` (decision-gated,
atomic: classifier authoritative-scope + chat-machine additive-variant
permission); `11-onboarding-step` (`SpeakerGenderStep` cloned from
`ReviewModeStep`, language-gated, `completeOnboarding` copy-through, appended
to `PROGRESS_STEP_ORDER` to avoid `resumeStepId` shifts).

## Critical files

- `lib/languages.ts` (:78 interface, :2386 derived-set block, :2550 re-exports)
- `lib/voices.ts` (:376 flip, :418 canonical resolver — unchanged, re-documented)
- `lib/speakerGender.ts` (new), `lib/translationProvenance.ts`
- `convex/schema.ts` (:34 courseSettings, :415 texts gender fields, :448
  translations, :521 audioAssets/audioRecordings, :1165 claims)
- `convex/types.ts` (:229 voiceGenderValidator, :317 SPEAKER_GENDER_VALUES)
- `convex/features/decks.ts` (:405 scheduleMissingContent, :533-700 the sweep
  being replaced, :2710 storeTranslationAndScheduleTTS)
- `convex/lib/cardContent.ts` (:98 serve batch, :375 `.unique()` landmine),
  `convex/lib/audioAssets.ts` (:186 upsertAudioPointer)
- `convex/features/llmTranslationQueue.ts`, `convex/features/ttsProcessing.ts`
  (claims), `convex/features/translationLLM.ts` (:107 instructions, :186
  context lines), `convex/features/sentenceMetadata.ts` (:22 prompt, :395
  apply)
- `convex/features/chat/{promptSections,messages,cardApprovals,approvalAudio}.ts`
- `convex/features/customTexts.ts`, `convex/features/collections.ts`,
  `convex/features/scheduling.ts` (:1690 flagTranslation, :1820
  regenerateCardAudio), `convex/features/courses.ts`
- `components/app/LearningModeSettings.tsx`, `messages/{en,de}.json`
- `data_preparation/gender_eval/` (new: gold dataset + reports),
  `scripts/evalSentenceMetadata.mjs` (new: eval runner)
