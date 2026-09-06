# Sentence-metadata classifier eval

Scores every field the production classifier prompt emits
(`convex/lib/sentenceMetadataPrompt.ts`), in one pass over both gold corpora.
Run it before and after any classifier prompt or model change and compare
reports.

```
pnpm eval:metadata
```

One API call per sentence returns all five fields, so scoring register and
gender together costs exactly what scoring gender alone used to cost. This
runner replaces the former `eval:gender` and `eval:politeness` commands.

## What it reads

The gold data still lives with the corpora that own it:

- `../gender_eval/data/<lang>.jsonl` — 508 entries whose `expected` labels
  `speakerGender`. See that folder's README for its curation rules.
- `../politeness_eval/data/<lang>.jsonl` — 143 entries whose `expected`
  labels a learner-facing tier, mapped to `register` (casual → informal,
  polite and formal → formal, neutral → neutral).

Either corpus may additionally carry `addresseeNumber`, `addresseeGender` and
`addressesSomeone` keys. Those three fields have no corpus of their own; they
are hand-labeled on the subset of both corpora where the answer is beyond
doubt (see below).

## Two nets

**Gold scoring.** Each entry is scored on the fields it labels. Unlabeled
fields are not scored.

**Snapshot diff.** Every full run records all five answers for all 651
sentences to `snapshots/<model>.json`. The next run diffs against it and
lists what moved. This is the only net under sentences and fields that carry
no gold label, and it reports *changed*, not *wrong* — read the diff and
judge. A partial run (`--language`, `--limit`, `--corpus`) never overwrites a
snapshot. Re-record deliberately with `--update-snapshot` once you have
accepted a change.

Commit the snapshot along with the prompt or model change that moved it, so
the next run diffs against the accepted state.

When you fix a gold label rather than the prompt, the model's answers have
not changed, so `--from-snapshot` re-scores the recorded ones offline and
rewrites the reports for free.

## Coverage of the three hand-labeled fields

| Field | Labeled | Classes |
|---|---|---|
| `addressesSomeone` | 208 | true 76, false 132 |
| `addresseeNumber` | 195 | singular 62, plural 1, not_applicable 132 |
| `addresseeGender` | 201 | female 26, neutral 43, not_applicable 132 |

The labeled groups, each a deliberate reading rather than a heuristic:

- Gender corpus, `addressee-not-speaker` (26): second-person singular with
  gendered morphology on the addressee. All address one woman.
- Gender corpus, `none-third-person` and `referent-not-speaker` (102):
  statements about a third party, no addressee.
- Politeness corpus, `descriptive-no-register` (30): timetables, weather,
  opening hours. No addressee.
- Politeness corpus, `tv-pronoun` (50): every T/V sentence addresses someone.

Deliberately left unlabeled:

- V-forms that are singular-polite **or** plural with nothing in the text to
  separate them (German `Sie`, French `vous`, Russian `вы`, Hindi `आप`). They
  carry `addressesSomeone` but no `addresseeNumber`. An author's note saying
  "addressed to one person" does not count: the classifier only sees the text.
- `addresseeGender` on the two sentences whose only addressee-gender signal is
  a vocative address term (`señora`, `madame`). Whether a lexical vocative
  sets `addresseeGender` is a question the prompt does not settle.
- `addresseeGender` on the four Hindi and one Thai T/V sentences. Hindi marks
  the addressee's gender in second-person verb agreement (`रहते` vs `रहती`),
  so a T/V sentence there is not automatically gender-neutral; Thai `เธอ`
  with `ฉัน` leans female without settling it. The first labeling pass got
  this wrong and called all five `neutral`; the eval caught it, because
  3.1-lite answered `male` on the Hindi ones and was right.
- Japanese 今日は天気がいいですね。 The agreement-seeking ね implies a listener
  without any second-person reference, so `addressesSomeone` is arguable.

**Known gap:** `plural` has exactly one gold instance (German `Kommt ihr…`),
because neither corpus was built to contain plural addressees. That class is
effectively unmeasured, and the snapshot diff is its only net. Filling it
means adding sentences with unambiguous plural agreement to one of the
corpora, which also means giving them a defensible primary label.

These three fields' labels were authored by an agent from the existing
sentences and glosses, not curated the way the two primary corpora were.
Spot-check before treating one as load-bearing.

## Flags

```
--validate-only         validate both corpora and exit (no API calls)
--model a,b             OpenRouter slugs to score (default: production);
                        each model gets its own report and snapshot
--corpus gender         restrict to one corpus (gender | politeness)
--language ru,ja        restrict to these language files
--limit N               at most N entries per language (smoke runs)
--concurrency N         parallel API calls (default 4)
--update-snapshot       overwrite the snapshot instead of diffing
--from-snapshot         re-score the recorded answers offline, no API calls
--out path.md           report path (single model only)
```

Each entry is evaluated as a single rendering, with no cross-lingual
siblings. That measures per-language classifier strength and is the lower
bound of what production sees, since production usually supplies several
renderings and any one marked language can fix a field.

On-demand only (it costs API credit), not part of CI.

## Layout

- `reports/<date>-<model>.md` — generated, committed on demand
- `snapshots/<model>.json` — the accepted answers, committed
