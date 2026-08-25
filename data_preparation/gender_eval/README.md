# Speaker-gender classifier gold dataset

A curated gold-standard dataset of sentences with known, verified
speaker-gender readings, used to measure the sentence-metadata classifier's
`speakerGender` accuracy across languages (`convex/features/sentenceMetadata.ts`).
Run the eval before and after any classifier prompt or model change and
compare reports.

## Layout

- `data/<languageCode>.jsonl` — one JSON record per line
- `reports/<date>.md` — eval runs (generated, committed on demand)

## Record schema

```json
{
  "language": "ru",
  "text": "Я устала.",
  "expected": "female",
  "phenomenon": "past-tense-verb",
  "glossEn": "I am tired / I got tired.",
  "sourceUrl": "https://en.wiktionary.org/wiki/уставать",
  "notes": "optional: names the exact marker"
}
```

- `language` must match the filename and is the code from `lib/languages.ts`.
- `expected` is the gold label for the classifier's `speakerGender` field:
  `male` / `female` when morphology (or an unambiguous lexical marker) fixes
  the SPEAKER's gender, `neutral` otherwise — including sentences in marked
  languages whose particular form happens not to mark it.
- `phenomenon` tags the marker (or the reason there is none), so report
  breakdowns can show WHERE a classifier fails. Vocabulary in use:
  `predicate-adjective`, `past-tense-verb`, `present-tense-verb`,
  `participle`, `verb-agreement` (a finite form that does NOT mark gender in
  this language, e.g. Russian present tense), `polite-particle` (th ครับ/ค่ะ,
  ja sentence-final particles), `pronoun` (gendered self-reference, ja 僕/あたし,
  th ผม/ดิฉัน), `kinship-term` (vi/ko self-reference terms), `thanks-form`
  (pt obrigado/obrigada), `role-noun` (de Lehrerin), `written-only-agreement`
  (fr fatiguée — audible vs written marking), `none-third-person`,
  `none-first-person` (first person present, no marking),
  `addressee-not-speaker` (ru «ты сказала…» marks the ADDRESSEE),
  `referent-not-speaker`, `quoted-speech`.
- The confusion cases (`addressee-not-speaker`, `referent-not-speaker`,
  `quoted-speech`) are deliberate traps: gendered morphology is present but
  does not refer to the speaker, so `expected` is `neutral`.

## Coverage

31 files cover all 34 languages configured as speaker-gender-marking
(`speakerGenderMarking` in `lib/languages.ts`); dialect variants whose
phenomenon is identical share the base file:

- `es_latam`, `es_mixed` → `es.jsonl`
- `vi_south` → `vi.jsonl`
- Arabic dialects differ enough to get their own files
  (`ar_sa`, `ar_eg`, `ar_iq`, `ar_lev`), plus MSA in `ar.jsonl`.

Six negative-control files for major UNMARKED languages (`en`, `de`, `zh`,
`tr`, `fi`, `id`) whose entries must classify `neutral` — with the deliberate
exception of lexical markers that fix the speaker's gender even in unmarked
languages (`role-noun`, `pronoun`), e.g. German "Ich bin Lehrerin."
(expected `female`): our config still treats German as unmarked for
*generation*, but the classifier should detect explicit self-descriptions.

508 entries total. Per-language sets span definitive-male, definitive-female,
neutral-despite-marked-language, and the confusion traps above.

## Curation rules (the 100% bar)

Only sentences whose gold label is beyond doubt were admitted:

- Every entry cites a `sourceUrl` (Wiktionary inflection tables, reference
  grammars, established grammar-reference sites) and names its exact marker
  in `notes`. Textbook-canonical paradigm sentences were preferred over
  invented ones.
- Any candidate with ambiguity — dialectal wobble, register-dependent
  reading, a marker native speakers dispute — was DROPPED. Fewer verified
  entries beat padding; some languages ship fewer than others for exactly
  this reason.
- Verification caveat: this container has no network egress to the cited
  sources, so the cited URLs were recorded but not re-fetched in-session;
  the bar was applied from linguistic knowledge during curation, plus a
  mechanical validation of every file and independent linguistic spot-checks
  across languages. Spot-verify the URLs before treating a single entry as
  load-bearing for a release decision.

Known per-language limits found during curation (why some sets are small or
skew toward certain phenomena):

- **Bulgarian (bg)**: the simple aorist does NOT mark gender ("аз казах" is
  unisex); only compound perfect/participle forms do — entries use those.
- **Baltic (lt, lv)**: finite verbs never mark gender; only
  participles/predicate adjectives do — sets lean on those forms.
- **Vietnamese (vi) / Korean (ko)**: gender surfaces through self-reference
  kinship terms and style, which are context-dependent more often than
  definitively gendered; the definitive subsets are deliberately small.
- **Arabic dialects (ar_eg, ar_iq, ar_lev, ar_sa)**: dialect orthography is
  not standardized; entries use common written renderings and stay with
  uncontroversial verb/adjective agreement, so these sets are small.
- **French (fr)**: much agreement is written-only ("fatiguée" sounds like
  "fatigué"); `written-only-agreement` tags these — the classifier sees
  text, so they are fair, but TTS-oriented uses should note the distinction.

## Running the eval

```bash
# Validate the dataset files (no API calls):
pnpm tsx scripts/evalSentenceMetadata.mjs --validate-only

# Full run (needs OPENROUTER_API_KEY, e.g. in .env.local):
pnpm tsx --env-file=.env.local scripts/evalSentenceMetadata.mjs

# Smoke run:
pnpm tsx --env-file=.env.local scripts/evalSentenceMetadata.mjs --language ru,th --limit 5
```

The runner imports the EXACT production prompt from
`convex/features/sentenceMetadataPrompt.ts` and the production model id from
`convex/config/aiModels.ts` (`OPENROUTER_MODELS.sentenceMetadata`), sends each
entry as a single rendering, and writes `reports/<date>.md` with per-language
accuracy, per-class precision/recall, and every misclassified sentence.

Single-rendering mode measures the per-language lower bound: production
usually sends several renderings of a sentence, where any one marked language
can fix the gender cross-lingually.

On demand only (API cost) — not part of CI.

## Baseline

**Pending: run `scripts/evalSentenceMetadata.mjs`** — this environment has no
`OPENROUTER_API_KEY`, so no report has been generated yet. The per-request
prompt builder landed before any baseline run, so for the before/after
comparison of that change, run the eval once at commit `cc46964` (the last
commit with the old static prompt) and once at HEAD. Languages scoring below
~90% should get targeted per-language prompt notes (the
`translationPromptNotes` pattern) and a re-run.
