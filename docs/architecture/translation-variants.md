# Rendering variants: first-person forms and politeness

How a course's sentence-form settings change what a card shows and hears,
and the invariants every reader and writer of `translations` and
`audioRecordings` must keep. Decided with Paul on 2026-09-05/06; the plan is
`~/.claude/plans/add-gender-and-politeness-abundant-kettle.md`.

## The four layers

1. `texts` is the identity of a meaning. Cards, review history, collections
   and search bind to `textId`. A text carries content semantics only: a
   definitive speaker gender when the sentence itself is gendered ("I'm
   pregnant", "We are brothers"), and the register metadata the classifier
   guessed. On a curriculum text those fields are evidence only when
   `texts.metadataSource` is the current classifier build
   (lib/sentenceMetadataSource.ts); before that they are the coin flips the
   sweep and the offline curation wrote, and the content sweep asks the
   classifier for the text lazily, from the source sentence alone, the
   first time a learner meets it (`requestSentenceMetadataIfNeeded`). The
   translations get no vote: they were generated from the coin flip and are
   the thing under suspicion. Nothing in the variant path ever writes a
   `texts` row.
2. `courseSettings.politenessLevels` (a SET of casual / polite / formal) is
   the preference. Undefined means canonical, which is exactly what every
   user saw before the feature. `onboardingProgress` carries the same field
   until `completeOnboarding` copies it over. There is NO course-level
   gender preference: the course choice (`firstPersonForms`) was withdrawn
   on 2026-09-08 before shipping, because rendering the curriculum in two
   genders doubles its cost. The column is still in the schema, stored on
   dev rows only, and nothing reads it. A curriculum sentence is rendered
   in one gender, the text's own voice (its classifier verdict or its coin
   flip), and every language of the card follows it: the translations are
   generated for that speaker and the clips are spoken in it. The gender
   chip on every card surface shows that voice. A card can carry its own
   correction, `cards.renderingGenderOverride` and
   `renderingPolitenessOverride`, written by the Flag dialog; it outranks
   the settings and applies to any curriculum card, stamp or not. The
   gender override is the one way a card leaves the text's voice, and the
   only producer of gender variants.
3. `lib/preferenceResolution.ts` is the one resolver. Given a text, a
   language, the settings and the card, it returns the card-wide gender axis
   and voice (`resolveCardRendering`) and, per language, the politeness form
   plus two keys (`resolveLanguageRendering`). It is pure and never writes.
4. `translations` and `audioRecordings` rows are disposable realizations.
   Canonical rows have no `variantKey`; variant rows carry one.

## Keys

Two keys, because a wording and a voice have different sharing:

- `textVariantKey = "<male|female|auto>|<formId|auto>"` on `translations`.
  The gender part is the card's voice only when this language's WORDING
  marks the speaker's gender (`firstPersonMarking` in lib/languages.ts), so
  a politeness variant of Turkish is generated once and shared by every
  voice. `auto` on an axis means "as canonical". Null means the canonical
  row itself. A mixed code (`es_mixed`) resolves its form through the
  canonical row's own dialect (`regionVariant`, `classificationLanguageForRow`),
  since Spain and Latin America map the levels onto tú / usted differently.
- `audioVariantKey = "<male|female>|<formId|auto>"` on `audioRecordings`,
  the concrete voice the card is spoken in. Null means the canonical audio,
  which is right only when the wording is canonical AND the text's
  coin-flipped voice already is the card's voice. A card corrected to the
  female voice on a Turkish sentence whose canonical voice is male reads an
  audio-only variant `female|auto` whose wording is the canonical one. The text's OWN language
  follows the same rule (`resolveSourceRendering`): its wording is the text
  and never varies, but the source clip, or the accent row's clip on a Mixed
  English card, is read and synthesized under `<voice>|auto` when the card's
  voice is not the canonical clip's. Every language of a card is heard in one
  voice.

The form ids come from `lib/languageForms.ts` (`plain`, `desu-masu`,
`keigo`, `t`, `v`, `particle`, ...). Only Japanese and Korean have three;
every other marking language has two, so a level set like {casual, polite}
resolves to one form on Spain Spanish (tú, whose split is "familiar") and
never alternates there, while on a "distance" language such as German it
alternates between du and Sie.

## Which cards follow the settings

- `cards.followsCoursePreferences` is stamped on curriculum cards created
  after the feature. Such a card resolves against the course's CURRENT
  settings on every read, so a settings change re-renders it (old renderings
  stay cached, so switching back is free).
- Cards without the stamp (from before the feature) and every card on a
  user-written text (custom, chat, import) never change with the settings:
  they read the canonical rows, which can still change for everyone through
  a flag, a curriculum fix or a correctness regeneration (invariant 3). The
  chips still show what those rows are, from the backfilled stamps.
- The pin outranks the variant. A settings-following card pinned to an
  archived revision (a version bump landed after its pin) is served that
  wording as it was, never a variant, and reports no variant gap: the
  variants are rewrites of the live wording (`resolveServedRendering`,
  `buildTextContentBatchForLanguages`).
- Chat approvals stamp the chosen form's voice (`texts.audioSpeakerGender`)
  but not `texts.register`; the rendering classifier stamps the stored
  wording later, which is what the chips read.
- Precedence for the gender axis: a definitive `texts.speakerGender` that
  is evidence (a user-written text's verdict, or a curriculum text at the
  current `metadataSource`), then the card's override; there is no setting.
  On an unclassified curriculum text the field is the coin flip the sweep
  wrote back, so it is ignored. A sentence that fixes its own gender is
  served canonical in that voice by every card.
- An address language (T-V) renders a sentence without a "you" the same at
  every level, so the resolver returns no form for it, and a row the
  classifier already stamped `renderedPoliteness: 'unmarked'` is likewise
  served at every level: nothing in "Hola." changes between tú and usted
  (`canonicalSatisfies`, 2026-09-09, after treating it as a gap left every
  pre-A1 greeting on "updating" for good and bought one rewrite per card).
  Predicate (ja, ko), particle (th, fil) and pronoun (vi, id, ms) languages
  get a form on every sentence, and `unmarked` there IS a gap, since a
  rewrite can add the carrier (Thai ครับ, Japanese です・ます). The
  generate-and-compare rule handles the ones that come out identical.

## Invariants

1. The variant path never writes `texts` or a canonical row, and it runs no
   provenance gate: `curated-manual` and other human-authored canonical rows
   get variants like any other, since the canonical row is only ever read.
   A user-created TEXT never reaches that code, because
   `resolveLanguageRendering` returns the canonical rendering for one and
   both keys go null.
2. Every point read of `translations` pins all four columns of
   `by_text_language_variant_supersededAt` and every point read of
   `audioRecordings` pins all three of `by_text_language_variant`. A prefix
   query plus `.first()` returns whichever row was created first, which is
   the silent-wrong-rendering bug. Outside `convex/schema.ts`, only
   `convex/db/translationReads.ts` may name
   `by_text_language_variant_supersededAt` or `by_textId_supersededAt`, and
   only it may query `audioRecordings` through `by_text_language_variant`.
   The two claims tables carry an index of the same name, which
   `llmTranslationQueue.ts` and `ttsProcessing.ts` query directly, so the
   audio rule is enforced as a table + index pair
   (`convex/tests/lib/translationsIndexInvariant.test.ts`).
3. A rendering is never deleted because another was requested. The
   gender-drift-by-preference deletions in the canonical sweep are gone; a
   canonical row keeps whatever gender it was generated under. Two
   deletions are sanctioned. A canonical WORDING change (flag, curriculum
   fix, version bump, metadata correction): `retireVariantRenderings` drops
   the pair's variant rows, keyed pointers (assets cached) and in-flight
   variant claims, because they were rewrites of the old wording; a rewrite
   job still running is dropped at the store by its `rewriteOf`, and the
   next ensure pass rewrites the variants from the new wording. And the
   regenerate-audio button (`regenerateCardAudio`), which drops the card's
   variant audio POINTER so the variant pass re-synthesizes the clip the
   card plays. Two in-place regenerations exist, both keep-row writes that
   archive the old wording for pinned cards: a `translationVersion` bump,
   and a `'metadata_correction'`, when the classifier has fixed the
   speaker's gender on a curriculum text and the row's `renderedGender`
   stamp proves the wording was written in the other one. Only a proven
   row: `unmarked` and unstamped rows are left alone. A row whose own
   `speakerGender` already IS the verdict is the model ignoring
   `<speaker_gender>` rather than a stale row, so it buys
   `MAX_GENDER_CORRECTION_RETRIES` (1) further attempts, counted on the row
   in `genderCorrectionAttempts` so a sentence the model will not re-render
   cannot loop. The correction runs BEFORE `sweepInvalidAudio` in
   `scheduleMissingContent` and marks its language, so the clip stays
   attached, whatever mismatch it has, for the archive that
   `replaceForVersionBump` writes when the new wording lands; detaching it
   first made that archive silently skip and moved pinned cards onto the
   new wording. A verdict on a row the classifier has not stamped yet holds
   only the GENDER re-voice of that language's clip while a stamp can still
   come (2026-09-09): the stamp may prove the wording itself needs
   correcting, and a male clip of a feminine sentence would be bought and
   replaced a pass later. Provider, version and accent drift are detached
   as usual. Otherwise the same verdict re-voices the canonical clips
   (`sweepInvalidAudio`), since no variant would ever replace them.
   Audio follows the same rule one level down: an `audioAssets` row is
   never deleted because the TTS setup (provider, `ttsVersion`) changed.
   The sweep and `scheduleMissingRenderings` detach a stale pointer with
   the asset kept, and the fresh synthesis creates a sibling asset under
   the new setup (`findAudioAssetByKey` filters on the setup), so a prompt
   or provider change rolls forward or back without re-synthesizing. Only
   the manual regenerate button and the orphan cascades delete an asset.
4. Variant LLM jobs never fall back to Google Translate (it cannot control
   gender or register); canonical keeps serving. Exhausted attempts keep
   the claim with `variantFailedAt`, which blocks another attempt for 24 h
   (`VARIANT_RETRY_COOLDOWN_MS`), so a sentence the model refuses is not
   re-bought on every card view; a canonical wording change releases it.
5. Claims are keyed by variant, so two learners with the same preference
   share one job.
6. Generate-and-compare: a variant whose wording equals the canonical row's
   is stored with `sameAsCanonical` (so the ensure path stops asking) and
   served as the canonical text with audio in the card's voice.
7. Every stored wording is stamped `renderedGender` / `renderedPoliteness`
   by the rendering classifier (`convex/lib/renderingClassifier.ts`): at
   generation for new rows, and lazily for rows from before: the canonical
   sweep (`scheduleMissingContent`) collects unstamped rows of marking
   languages and `flushRenderingStamps` asks the classifier for them, 25
   rows per call, claimed on the row (`renderingStampRequestedAt`, 15 min
   cooldown) so repeated sweeps do not double the call. The upcoming-cards
   and collection-warm loops share one collector per pass. While a stamp is
   pending, the rendering sweep asks for no rewrite of that row
   (`renderingStampPending`), since the next pass may find the canonical
   row already is the requested form. The stamps feed the chips and the
   shortcut "the canonical
   row already is the requested form, schedule nothing".

## Prompts

`convex/features/translationLLM.ts` takes `requestedGender` and
`requestedForm` (a form from `lib/languageForms.ts` with its own instruction
text). A requested form is emitted as `<register>` whether or not the
sentence addresses someone, with `requestedFormInstruction` in the
instructions block ("Required politeness form: {label}. {prompt} This
overrides the register rule above. Apply it to every sentence, including
sentences that address nobody, wherever the language marks it. Only when the
source is inherently register-locked ... stay faithful to the source"),
mirrored into the best-of-N judge. A canonical job of a predicate- or
particle-marking language ALWAYS requests a form, because the addressee gate
would otherwise starve it: the level the text's register metadata names
('informal' = casual, 'formal' = polite), else the language's `defaultLevel`
(polite for ja, ko, th and fil; `requestedRendering` in
llmTranslationQueue.ts). That is how new shared Japanese rows stop leaning
casual.

This is the 2026-09-06 wording, kept on purpose. A research-backed candidate
(plan section 8E: register rule dropped when a form is requested, the
requirement after `<source>`, gender line before the form line, per-form
prompts listing the carriers with one example) was A/B-tested on 2026-09-07
and lost Japanese keigo on the rewrite path (judge in-form 78% to 68%,
through three prompt iterations) while gaining nothing on the fresh path
(99 vs 98 on ja, 100 vs 100 on ko), so Paul kept the current wording. The
candidate wrapper and prompts stay in `scripts/eval-adherence.ts` as the
`candidate` arms. Two of the candidate's factual additions did ship as
prompt text: the Thai particle prompt says what to do without a stated
speaker (ค่ะ/คะ), and the Croatian, Serbian and Bulgarian agreement rules
are the corrected ones.

A VARIANT is a REWRITE of the canonical wording, not a fresh translation:
`buildRenderingRewritePrompt` (`rewriteOf` on the job) asks the model to
change only what the form requires and to return the sentence unchanged
otherwise. The 2026-09-06 gender-relevance bench showed two independent
translations of one sentence drifting in unrelated wording on a third of
the pairs ("Je me suis perdu en ville" became "perdue dans la ville"),
which would have made every such variant a separate clip; the rewrite arm
of the adherence bench returns the baseline wording untouched wherever the
form does not bite. The variant job therefore waits for the canonical row
and never falls back to Google Translate. Every job that requests a form,
variant or canonical ja/ko/th/fil, sends `promptWording: 'literature'` (speech
level, T-V distinction, speaker gender agreement), which edged out the
app's wording by a few tenths in the first adherence bench; the bench runs
the same wording.

## Benches (2026-09-06 and 2026-09-07 results)

- `pnpm eval:metadata`: the sentence-metadata classifier on the gold corpora
  (`data_preparation/gender_eval`, `politeness_eval`), 651 sentences.
- `pnpm eval:rendering`: the rendering classifier on the gold corpora plus a
  judged wild sample of 176 live rows. Gemini 3.1 Flash Lite with the
  product wording: 98.7% gender / 100% wild, 79.0% politeness gold / 92.6%
  wild, $0.18 per 1000 rows. 3.7 Flash was no better on gold at seven
  times the price and collapsed on ja/ko with the literature wording; Luna
  lost 4 points on gender. The politeness gold misses are mostly
  "casual" rows the models call "formal" on pt, zh and es, worth a look at
  the corpus labels before trusting them. Thinking does not help: the
  `-minimal` and `-low` arms (`--models=flash-lite-31-low,...`) showed
  that OpenRouter's `minimal` buys no reasoning tokens on Flash Lite, that
  `low` on 3.1 Flash Lite costs 27% more and loses 2 points on gender gold
  and 11 on the wild sample, and that 3.7 Flash thinks by default (1076
  output tokens per batch for 400 of JSON), which is where its price comes
  from. Run-to-run noise at temperature 0 is about 5 points on the 143-row
  politeness gold set, so differences below that are not signal.
- `pnpm eval:gender-relevance`: which sentences the speaker's gender changes
  at all (double generation, judged). First-person sentences are marked on
  8 to 12 of 12 in ru, pl, cs, it, ar, he, th and 2 to 5 in fr, es, pt, el,
  hi (silent agreement or dropped pronouns); ja and ko mark none in the
  polite register. A cheap predictor reached 62 to 82% precision at 75 to
  100% recall on the marked languages; the generate-and-compare rule plus
  the rewrite prompt makes a pre-filter unnecessary for now.
- `pnpm eval:adherence` (2026-09-06, 15 sentences): today's prompt renders
  0% of descriptive Japanese and Korean sentences in the polite form (the
  reported bias); with a requested form the judge scored 9.5 to 10 on every
  language, and the female-speaker request lifted fr/ru/es/hi/pl from 4 to 6
  to 10.
- `pnpm eval:adherence` A/B (2026-09-07, $3.73 in all; report copies
  `.scratch/adherence-bench/report-2026-09-07-wrapper-ab.txt` (10 languages,
  rewrite 2x2), `report-2026-09-07-jako-fresh.txt` (ja, ko with the fresh
  arms) and `report-2026-09-07-ja-keigo-fix.txt` (ja after the keigo
  iterations)): the harness was first fixed so it could tell wordings apart
  (judge frozen on label + description + example with two yes/no questions
  instead of the wrapper under test as rubric; Unicode-safe word boundaries,
  the old ASCII `\b` read Russian as 0% for both forms; ください no longer
  contradicts the desu-masu check; the 합쇼체 check matched no composed
  syllable; mechanical pass counted over carrier sentences only; prompt
  hashes in the cache keys). 40 sentences (27 with a "you", 10 first
  person), 10 languages, 880 politeness and 200 gender requests,
  `promptWording: 'literature'`. Rewrite path, wrapper {current, candidate}
  x per-form prompts {current, candidate}, pooled over languages, the four
  corners are within noise: mechanical pass 88/87/88/88%, judge in-form
  99/97/98/98%, meaning kept 96/95/95/95%, identity to the canonical
  wording 50/50/46/49% (current-current / current-candidate /
  candidate-current / candidate-candidate). Gender requests are 100%
  in-form on every corner (baseline 88%). Per language, judge in-form,
  forms pooled, current vs candidate: ja 96 vs 89, ko 98 vs 98, de 100 vs
  100, fr 100 vs 100, ru 100 vs 100, es 100 vs 100, hi 100 vs 99, th 100
  vs 100, pl 99 vs 100, vi 96 vs 98. Fresh path (ja, ko; what a canonical
  ja/ko job runs): current 100 vs candidate 99 pooled, ja 99 vs 98, ko 100
  vs 100, no form below 98% on either. Judge noise on 40 sentences is about
  8 points. What is not noise: Japanese keigo on the REWRITE path loses
  with the candidate wording, through three prompt iterations (judge 88 to
  68 with the full 8E prompt, 80 to 55 after restoring いたします and the
  丁重語-for-neutral clause, 80 to 58 without the 〜ていただけますか request
  clause, 78 to 68 with the current wording plus an example): the
  candidate wrapper's "at every place that can carry it" makes the rewrite
  settle for the smallest edit of a です・ます canonical ("大丈夫ですか",
  "ちょっと待っていただけますか") where the current one reaches 存じます /
  でいらっしゃいます; the fresh path is 98% either way. Korean 합쇼체 dropped
  98 to 90 under the candidate wrapper because the canonical's casual 네/내
  survived in front of the 습니다 ending; naming the listener ("by name or
  title with 님, not 너/네") in the candidate's polite prompts brought it
  back to 98. Vietnamese respectful gains under the candidate wrapper (96
  to 98) but the current wrapper with the candidate prompt collapses to 81%
  (bạn kept, ạ added). Identity rates fall where the candidate prompts
  name a pronoun the canonical dropped: vi peer 50 to 37%, th plain 78 to
  73%. Decision (Paul, 2026-09-07): production keeps the 2026-09-06 wrapper
  and prompts. Also seen: Sol writes "Я чувствую усталость" /
  "เหนื่อยแล้ว" for "I'm tired" when the speaker is unspecified and every
  rewrite arm keeps it, so a gendered variant of such a canonical row never
  surfaces the gender.

All four judge with `google/gemini-3.8-flash` and read the key from the
environment by name. Reports and caches live under `.scratch/<bench>/`.
