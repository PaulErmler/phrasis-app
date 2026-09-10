# Pronunciation-aid gold dataset

Curated IPA and romanization for the seven languages espeak-ng could not
serve, used by `pnpm eval:ipa` (`scripts/eval-ipa.ts`) to measure whether a
replacement engine is good enough to turn those languages back on.

## Why it exists

A user reported Thai IPA rendering as `sˈa5wmsaɜds` for สวัสดี. An audit of
all 59 languages with an `ipaVoice` (`tests/node/espeak-ipa.test.ts` now runs
it as a test) found the same class of failure in six more:

| Language | What espeak did |
|---|---|
| Thai | Its dictionary is 2.3 kB against Mandarin's 1.5 MB, and Thai cannot be read without one, so the voice invented phonemes |
| Hebrew | Could not vowel unpointed script: 62% of tokens came out with no vowel (תודה רבה → `todˈa rvh`) |
| Arabic | Same, on 15% of tokens (ذهبت → `ðhbt`), and it read كم as "kilometre" |
| Mandarin | Wrote tone as ASCII digits, and collapsed them: 妈 and 骂 both gave `mˈɑ5` |
| Cantonese | Emitted Jyutping spellings rather than IPA (廣東 → `ɡwˈonɡ2`) |
| Vietnamese | Invented tone digits, including an impossible `7` |
| Korean | Wrote ㄱ as `q`, skipped assimilation (한국말 → `hɐnquqmɐɫ`) |

All fourteen affected language codes lost their `ipaVoice` in Sep 2026. This
dataset is how a candidate replacement earns the slot back.

Hebrew and Arabic are in here for romanization too, not only IPA: their
shipped local romanizers fail the same way the IPA did
(`hebrew-transliteration` gives `šlwm lkwlm` for שלום לכולם).

## Layout

- `data/<languageCode>.json` — one file per language. Committed: curating it
  cost real effort and the eval cannot run without it.
- The result cache and the report land in `.scratch/ipa-eval/`, gitignored.

## Record schema

```json
{
  "language": "th",
  "notes": "conventions, divergences and what was excluded — read before scoring",
  "items": [
    {
      "tier": "word",
      "text": "แมว",
      "ipa": "mɛːw˧",
      "romanization": "mɛɛo",
      "source": "en.wiktionary",
      "sourceUrl": "https://en.wiktionary.org/wiki/แมว"
    }
  ]
}
```

- `text` is the input as a learner would write it. For Hebrew and Arabic that
  means **unpointed**, without niqqud or harakat, because supplying the vowels
  is the whole task; the pointed form is kept alongside in `vocalized`.
- `ipa` is broad and phonemic, with no enclosing slashes. Tone is written with
  Chao letters (˥˦˧˨˩), never ASCII digits.
- `romanization` is learner-facing and carries vowels: RTGS for Thai, Pinyin
  with diacritics for Mandarin, Jyutping for Cantonese, Revised Romanization
  for Korean, and a vowelled transcription for Hebrew and Arabic. It is `null`
  for Vietnamese, which is already Latin. Some rows also carry
  `romanizationAcademic` or `romanizationStressed` holding the source's own
  form verbatim.
- **Thai is RTGS, not Paiboon**, because RTGS is what production emits
  (`convex/lib/romanizationPrompt.ts`). The Royal Institute standard records
  neither tone nor vowel length, so เขา, ขาว and ข้าว are all `khao` and no
  Thai value carries a diacritic. The Paiboon form the file was first
  harvested with is kept in `romanizationPaiboon`, with
  `romanizationPaiboonAlternatives` alongside it. That is reference only:
  never rename it to `romanizationAcademic`, `romanizationStressed` or
  `romanizationSandhi`, which `acceptedRomanizations()` reads as equally
  correct answers — under RTGS a Paiboon answer is wrong, and accepting it
  would let a wrong engine score 100%.
- `sourceUrl` is mandatory and is a page that was actually fetched.
- `ipaAlternatives` holds a headword's other attested readings, with
  `romanizationAlternatives` (and, for Thai, `romanizationPaiboonAlternatives`)
  positionally aligned to it. An engine is credited with whichever reading it
  came closest to, and IPA, tone and romanization are then all scored against
  that same reading.

## Tiers

`word` rows measure symbol accuracy at scale. `sentence` rows are the ones
that matter: Thai word segmentation, Mandarin tone sandhi and Korean
assimilation across boundaries only appear in connected speech, and a
word-tier row can be right for the wrong reason.

| Language | word | sentence |
|---|---|---|
| ar | 185 | 100 |
| he | 185 | 89 |
| ko | 200 | 100 |
| th | 180 | 103 |
| vi | 180 | 100 |
| yue | 200 | 100 |
| zh | 200 | 100 |

Where a sentence tier stops short of 100 the supply ran out, not the effort:
Hebrew has only 115 unpointed multi-word Wiktionary entries with a
Modern-Israeli transcription, and Thai's 103 is the whole attributable set.
Each file's `notes` says where and why. **Nothing was padded to hit a number.**

## Provenance

Every row comes from English Wiktionary, harvested through the kaikki.org
per-language JSONL exports. Frequency lists (PyThaiNLP corpora, OpenSubtitles
`FrequencyWords`) chose *which* rows to include and supplied no transcription.

Two traps the curation had to work around, both worth knowing before extending
this:

- **kaikki flattens a page's `sounds` array onto every part-of-speech entry**,
  so `sounds[0]` is regularly the wrong homograph's IPA. Rows were kept only
  where the IPA and the romanization agree segment-for-segment, which rejected
  728 Hebrew and 900 Arabic candidates and caught real upstream errors (Hebrew
  ספר pairing *sipér* with /saˈfar/).
- **Wiktionary lemmatises Hebrew at *ktiv haser***, so בוקר — how everyone
  writes "morning" — matches only the "cowboy" lemma.

Ambiguous headwords carry every attested reading in `ipaAlternatives` rather
than being excluded. They were dropped in the first pass, when a row could hold
only one answer, and that quietly removed core vocabulary — Arabic كيف حالك and
كتاب, Hebrew בית and ספר, Thai ฉัน and เขา. An eval missing the first words a
learner meets measures an easier task than the app actually does.

## Tone notation — read before scoring

The files are internally consistent in Wiktionary's convention, which diverges
from Wikipedia's `Help:IPA/*` pages in two places. Nothing was converted.

- **Vietnamese** disagrees on four of six tones: ngang `˧˧` vs `˧`, sắc `˧˦`
  vs `˧˥`, ngã `˦ˀ˥` vs `˧ˀ˥`, nặng `˧˨ʔ` vs `˧ˀ˩`.
- **Thai** uses Chao letters here where `Help:IPA/Thai` uses vowel diacritics.

The scorer folds syllable dots and spaces together, strips stress marks and
ties, and lowercases, so those choices cost nothing. It does **not** normalise
tone notation, which is why this section exists.

One separator choice is folded but still worth knowing about. Thai
`romanization` keeps Wiktionary's hyphen at every syllable boundary inside a
word (`sa-wat-di`), where published RTGS joins them (`sawatdi`) and hyphenates
only to break a real ambiguity. The scorer also scores a fully joined
comparison and takes the better of the two, so an engine answering `sawatdi`
still scores 1.0 — but `exact` compares the normalized strings literally, so
that column reads as a failure for Thai when the engine is right. Read `rom`
and `base` for Thai.

## Extending it

Add rows the same way: fetch a real page, record its URL, and drop anything
you cannot attribute. A gold set nobody can audit is not ground truth, and a
wrong one is worse than no eval at all — it produces confident numbers about
the wrong thing.
