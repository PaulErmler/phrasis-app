# Speaker-gender preference

Status: Implemented on branch (review pending)
Branch: `claude/gender-based-card-translation-y9do2t` (off `development`)

## What Paul asked for

Users choose their gender (male / female / mixed). Cards are then translated
for that speaker gender — but only for sentences and languages where speaker
gender actually changes the sentence — and audio is spoken by a voice of that
gender. "Mixed" keeps exactly what the dataset does today. Chat is prompted to
generate sentences in the chosen gender. Custom-uploaded sentences keep their
own inherent gender (a sentence that is clearly spoken by a woman keeps a
female voice regardless of the preference). Additionally: research, for every
supported language, whether speaker gender affects its grammar/lexicon at all,
and record that in the language config. The feature must be architected so it
can later be switched off globally, reverting everyone to "mixed".

## What "mixed" is today (double-checked)

There is no single dataset gender. Speaker gender is machine-assigned per
sentence and is a ~50/50 mix:

- OGTE v1 (active dataset) ships **no** speaker gender
  (`convex/admin/uploadDataset.ts` doesn't accept the field). On first content
  generation, `resolveCardSpeakerGenders` (lib/voices.ts) coin-flips
  `speakerGender` + `audioSpeakerGender` deterministically from the text `_id`
  (premade case 3), the translation prompt's `<speaker_gender>` tag uses that
  value, and the TTS voice matches it.
- Legacy Tatoeba rows were batch-translated offline with a per-sentence
  `random.choice(['male','female','neutral'])`
  (data_preparation/translate_sentences.py), LLM-overridable from
  pronouns/names.

So "mixed" = keep the stored per-text gender assignment. That is the default
and the no-op path of this feature.

## Setting

`userSettings.speakerGenderPreference: 'male' | 'female' | 'mixed'` (optional;
absent = mixed). Per **user**, not per course — it's the user's identity.
Written via a dedicated mutation; read server-side through one helper (see
kill-switch).

## Language config: `speakerGenderMarking`

New **required** field on `Language` (lib/languages.ts), so every entry
documents its answer:

- `'grammatical'` — morphology agrees with a first-person subject (verbs,
  adjectives, participles): es/es_latam/es_mixed, fr, it, pt, pt_pt, ro, ca,
  ru, pl, sk, cs, hr, sl, uk, sr, bg, lt, lv, is, el, hi, ar + all Arabic
  dialects, he.
- `'lexical'` — no agreement morphology, but required word choice depends on
  the speaker's gender: de, nl (self-referential role nouns Lehrer/Lehrerin,
  leraar/lerares), ko (kinship 형/오빠, 누나/언니), ja (first-person pronouns
  and particles in casual register), vi/vi_south (relational self-reference
  anh/chị/em), th (polite particles ครับ/ค่ะ + pronouns ผม/ดิฉัน).
- `'none'` — speaker gender never changes the sentence: en (all variants), et,
  sv, nb, da, fi, bn, ta, te, tr, hu, zh (both), yue (both), id, ms, fil, fa,
  sw, sw_tz.

Plus `speakerGenderPervasive?: true` on `th` only: Thai's polite particles
attach to nearly every sentence, so the first-person prefilter (below) must not
gate Thai.

Helper: `languageMarksSpeakerGender(code)` (`marking !== 'none'`). Audio voice
gender is independent of this flag (voices exist in both genders for every
language); the flag gates only translation variants.

## Which sentences get a gendered variant

Only premade texts in marking languages, and only when the stored gender
differs from the preference, and only when the sentence can actually change:

- Source text (always English for premade rows) matches a first-person
  pronoun regex (`I, I'm, my, we, us, ...`) — OR the language is
  `speakerGenderPervasive` (Thai).
- Over-triggering is harmless: the variant generator runs the same prompt at
  temperature 0 with only `<speaker_gender>` swapped; a gender-irrelevant
  sentence yields the same text, which we store anyway so the check never
  reruns.

## Architecture: overlay, never touch shared rows

`texts` and `translations` rows are shared across all users (one row per
(textId, targetLanguage), read with `.first()` at ~32 call sites). A per-user
preference must therefore never patch premade `texts` rows or reuse the
`translations` table for variants.

### New table `translationVariants`

Keyed `(textId, targetLanguage, speakerGender)`; holds
translatedText/romanization/IPA/source/version/regionVariant plus a
pending-claim lifecycle (`claimedAt`, `workId`, `status`). The row doubles as
its own generation claim — no changes to `llmTranslationClaims`. Only ever
holds the gender **opposite** to the base row's stamped gender (the base row
already serves the ~50% of texts whose coin flip matches the preference).

### Read path (single chokepoint)

`buildTextContentBatchForLanguages` (convex/lib/cardContent.ts) gains an
optional `speakerGenderPreference` opt, threaded from its six consumers (each
reads userSettings via one helper). Per (text, language):

- Effective gender = content-forced text gender (user-created texts with a
  definitive LLM verdict) → else preference → else stored
  `audioSpeakerGender`.
- Translation: if marking language + variant applies + base row's stamped
  gender ≠ effective gender → overlay the ready variant row; else base row.
  While the variant is pending, serve the base row (never mix a voice of one
  gender with text of the other).
- Audio: resolve via the content-addressed `audioAssets` key
  (language, effectiveGender, regionVariant, hash(servedText)) — gender is
  already part of that key, so no schema change. Fall back to the pointer
  (`audioRecordings`) asset when the preferred-gender asset doesn't exist yet.
- `hasMissingContent` learns two new terms (variant translation missing /
  preferred-gender audio missing) so the existing `useEnsureContent` →
  `ensureCardContent` self-heal loop schedules generation lazily, only for
  cards the user actually views.

### Write path

- Variant translation: `ensureCardContent`/`scheduleMissingContent` (pref
  threaded in from authed entry points only) inserts a pending
  `translationVariants` row and schedules a queue job that reuses the existing
  prompt/stage machinery (`translationLLM.ts` + the worker's metadata
  resolution) with `speakerGender` overridden; register, addressee, referent
  and arc context stay as stored. On success it stores the variant and chains
  pointerless TTS.
- Variant/preferred audio: the existing TTS pipeline with an `assetOnly` flag —
  full synthesis + STT validation + word timings, writing the `audioAssets`
  row but **not** repointing `audioRecordings` (mixed users keep their audio).
  Assets are content-addressed, so flipping preference back and forth is free
  after first synthesis.

### User-created texts (custom + chat): no variants needed

They belong to one user, so the preference applies at creation instead:

- The LLM metadata verdict still runs; a **definitive** male/female verdict
  (the sentence itself is gendered, e.g. "Estoy cansada") always wins — this
  is Paul's "uploaded female sentence keeps female audio" rule, and it's the
  existing case-1 behavior.
- Where today a coin flip resolves neutral/unknown
  (`applyTextMetadata`, `customTexts.createCustomText`,
  `approvalAudio.approvalGenderCandidates`), the preference replaces the flip.
- Chat additionally gets a `buildSpeakerGenderSection` prompt section
  (dynamic, uncached context — mirrors `buildDifficultySection`) so generated
  sentences are phrased for the user's gender in marking languages.

## Kill-switch (not implemented, architected for)

Every consumer resolves the preference through a single helper
(`resolveSpeakerGenderPreference` in `lib/speakerGender.ts`, shared
client/server). Turning the feature off later = make that helper return
'mixed' (one constant / env read) + hide the settings control via the same
module. Because "mixed" is the no-op path everywhere (reader overlays nothing,
writers coin-flip as today) and variants live in a separate table, switching
off instantly reverts behavior for existing and new users with no migration;
orphaned variant rows and assets are inert cache.

## UI

Control in the account settings screen (`SettingsView.tsx`): Mixed (default) /
Female / Male, with copy explaining voices always follow the choice and
sentences are re-phrased only in languages that mark speaker gender (the
description names the user's course languages that do). en + de strings.

## Out of scope (this iteration)

- The actual off-switch/flag plumbing (architecture only, per Paul).
- Re-translating existing **user-created** cards when the preference changes
  later (they keep the gender they were created under, like uploads).
- Per-voice (not per-gender) favorites — the audioAssets `voiceName` key
  column already anticipates that separately.
- Onboarding step asking for gender (settings-only for now).
