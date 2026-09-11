# Hyperliteral gloss gold dataset

Scraped, attributable reference glosses for `pnpm eval:hyperliteral`
(`scripts/eval-hyperliteral.ts`), which measures whether a model can produce
the word-for-word gloss line the app shows under a sentence.

## What a hyperliteral gloss is

It shows what each word is doing, in the sentence's own order. It is not a
translation, and it is allowed to read as broken English.

```
Мне       нравится  гулять   по     городу  вечером.
To-me     pleases   to-walk  around city    in-evening.
```

The contract lives in `convex/lib/hyperliteralPrompt.ts`, which this eval
imports rather than restates.

## The Leipzig problem, and what this dataset does about it

Every corpus of human-written glosses glosses in the **Leipzig style**, which
is what linguists read:

```
thief hit-PST.3SG woman-PRT and run-PST.3SG away
```

The app deliberately does not. A learner reading `I.DAT please.3SG.REFL
walk.INF` learns nothing they can use.

A first version of the builder tried to **convert** Leipzig into the app's
style with a tag table. It produced a reference that was wrong in ways that
would have silently poisoned every number: `I.NOM` became `[i]` because `I` is
uppercase, German's circumfixed `PST.PTCP-see-PST.PTCP` became
`ed-ing-see-ed-ing`, and `DEF.ART` became `the-the`. A manufactured reference
that is wrong is worse than no reference at all.

So **nothing is converted.** Each row keeps the source's own line verbatim in
`glossRaw`, and the only derived field is the **lexical skeleton**: the same
units with the grammatical tags deleted, which is a deletion rather than a
judgment.

```
glossRaw  "thief hit-PST.3SG woman-PRT and run-PST.3SG away"
lexical   ["thief", "hit", "woman", "and", "run", "away"]
```

The scorer compares the model's gloss to that skeleton position by position,
so it measures what the source actually asserts — which word means what, and
in what order — and leaves the app's surface convention (hyphens, bracketed
labels, no Leipzig tags) to the mechanical checks and the judge's rubric.
`null` in `lexical` marks a position whose gloss is pure grammatical concord
and carries no lexeme; the scorer skips those rather than counting them
against the model.

## Record schema

```json
{
  "text": "Pöydällä on kirja.",
  "lexical": ["table", "be", "book"],
  "glossRaw": "table-ADE be.PRS.3SG book.NOM",
  "free": "There is a book on the table.",
  "source": "glosslm/uratyp",
  "sourceUrl": "https://huggingface.co/datasets/lecslab/glosslm-corpus"
}
```

`transcriptionRaw` appears on GlossLM rows and holds the morpheme-segmented
original before de-segmentation (below).

## Sources

Both are public, and every row records which one it came from.

**English Wikipedia**, via the `{{interlinear}}` and `{{fs interlinear}}`
templates, read as wikitext through `action=parse` so the template parameters
survive. Every article embedding either template is harvested (1,404 of them),
and a row is kept only where the template carries an explicit `lang=`. The
language is never inferred from the article title: a guess is not attribution.

**GlossLM** (`lecslab/glosslm-corpus`, Apache 2.0), through the Hugging Face
datasets-server, for languages Wikipedia leaves thin. Used **only** for
languages written in Latin script: GlossLM transcribes Russian, Japanese and
Korean in transliteration (`Ne begalo tarakanov`), and the app glosses native
script, so those rows would measure a task the app never performs.

## Traps the extraction had to work around

Each of these was found by reading the output, and each one silently produced
plausible-looking rows before it was fixed.

- **The second template parameter is not always the gloss.** With four content
  lines it is source / transliteration / gloss / free; with three it may be
  either source / gloss / free or source / transliteration / free. The role is
  detected per template by how gloss-like each middle line is, and a page that
  supplies only a transliteration is rejected rather than guessed at.
- **Romanized varieties tagged with the standard language's code.** The
  Hachijō grammar article glosses `ara kanasike terebjo` as `lang=ja`. A script
  check per language drops those (Japanese rows must contain kana or kanji).
- **Regional varieties tagged as the standard language.** 42 of 88 Chinese
  rows came from one article on the Sanxiang dialect, a Yue/Min variety.
  Article-level blocklist in `scripts/build_gold.py`.
- **Wrong-language rows inside a GlossLM language file.** A German sentence was
  filed under Finnish. Rows with several function words of the wrong language
  are dropped.
- **Tags glued to stems when wiki markup is stripped** (`meGEN`,
  `televisionACC`), because the tag sat in a small-caps template. The boundary
  is unrecoverable, so the row goes.
- **Morpheme-segmented source text** (`Gel-diğ-im-i`). The app is given
  ordinary orthography. GlossLM rows are de-segmented on the way in, and a
  hyphen before a capital is treated as a real one, which drops the row rather
  than corrupting it. A Wikipedia row that is segmented is dropped outright.

## Coverage

Rows are 3-12 words, one gloss unit per source word, deduplicated by sentence.

| Language | rows | source |
|---|---|---|
| fi | 120 | GlossLM |
| hu | 120 | GlossLM |
| tr | 118 | Wikipedia + GlossLM |
| ja | 54 | Wikipedia |
| zh | 46 | Wikipedia |
| yue, vi, de, th, ko, hi | 12-33 | Wikipedia |

The eval headlines **fi, hu, tr, ja, zh**. The rest are kept because they cost
nothing to keep and a later prompt change may want them, but a per-language
number from 20 rows is noise, not evidence.

**Russian is absent, and that is a finding, not an oversight.** Wikipedia
yields six usable Russian rows, and GlossLM's Russian is transliterated. There
is no attributable native-script Russian gloss corpus in either source. Add
Russian when a real one appears; do not fill it with model output.

## Rebuilding

```bash
python3 data_preparation/hyperliteral_eval/scripts/build_gold.py
```

Wikitext is cached under `scripts/wtbatch/` and the GlossLM pull under
`scripts/glosslm_cache.json`, so a rebuild after a filter change costs no
network. Delete either to re-pull.

## Extending it

Add rows the same way: fetch a real page, record its URL, and drop anything
you cannot attribute. **Nothing here is model-generated**, and nothing was
padded to hit a row count. A gold set nobody can audit is not ground truth,
and a wrong one is worse than none: it produces confident numbers about the
wrong thing.
