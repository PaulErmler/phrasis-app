# Politeness-register classifier gold dataset

Authored gold-standard sentences with unambiguous register readings, used to
measure a politeness/register classifier across languages. Mirrors
`data_preparation/gender_eval/`. Both corpora are scored by the shared runner
in `data_preparation/metadata_eval/`: run `pnpm eval:metadata`, or
`pnpm eval:metadata --corpus politeness` for this corpus alone.

## Layout

- `data/<languageCode>.jsonl`, one JSON record per line, for
  ja, ko, th, de, fr, es, ru, hi, zh, pt (143 entries, 12 to 16 per language).

## Record schema

```json
{"language":"ja","text":"週末は何をしますか。","expected":"polite","phenomenon":"sentence-final-style","glossEn":"What will you do on the weekend?","notes":"names the exact marker"}
```

No `sourceUrl`: these are authored examples, not citations. `notes` is
optional but every non-neutral entry names its exact marker there.

## Labels

`expected` is the register the sentence's OWN grammar marks:

- `casual`: plain style or T-form. ja plain だ/する, ko 반말 (해체), de du,
  fr tu, es tú, ru ты, hi tum, zh 你, pt você.
- `polite`: the standard polite style. ja です/ます, ko 해요체, and the V-form
  when politely addressing someone: Sie, vous, usted, вы, āp, 您,
  o senhor / a senhora.
- `formal`: the distinct deferential tier, which only ja, ko, and th have
  here. ja keigo (尊敬語/謙譲語), ko 합쇼체 (-습니다), th ครับ/ค่ะ plus formal
  vocabulary. Never use `formal` for de, fr, es, ru, hi, zh, or pt; their
  V-form is `polite`. Since th's particle tier maps to `formal`, the th file
  has no `polite` entries (casual/formal/neutral only).
- `neutral`: nothing in the sentence marks a register. Descriptive
  third-person sentences with no addressee, including ja/ko bare plain-form
  expository prose (dictionary/newspaper style). Plain form WITH
  conversational cues (final particles, contractions, an addressee) is
  `casual` instead.

## Trap entries

- `quoted-speech`: casual speech quoted inside a polite frame. The frame's
  register governs, so `expected` is `polite`.
- `honorific-vocab-plain-base`: honorific vocabulary honors the referent, but
  the plain base fixes the addressee register (ja 召し上がった? and ko 진지
  드셨어? are both `casual`).
- `fossilized-formula`: set phrases (por favor, merci, спасибо, いただきます,
  谢谢) set no register; the surrounding grammar does.
- Boundary and minimal pairs: ko 해요체 vs 합쇼체, th ครับ vs ค่ะ (both
  `formal`), hi tum vs āp, zh 你 vs 您, pt você vs o senhor / a senhora.

## Phenomenon vocabulary (closed set)

`sentence-final-style`, `tv-pronoun`, `honorific-verb`, `polite-particle`,
`speech-level`, `fossilized-formula`, `quoted-speech`,
`descriptive-no-register`, `honorific-vocab-plain-base`, `address-term`.

## Consuming it

A runner reads every `data/*.jsonl`, sends each `text` through the classifier
prompt, and scores the returned register against `expected`, with per-language
and per-phenomenon breakdowns (the `phenomenon` tag shows WHERE a classifier
fails). Same consumption shape as `gender_eval`; on demand, not CI.
