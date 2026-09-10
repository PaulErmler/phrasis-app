# Sentence-metadata classifier eval — 2026-09-07

- Model: `google/gemini-3.1-flash-lite`
- Prompt: `convex/lib/sentenceMetadataPrompt.ts` at this commit
- Entries: 691 (re-scored offline from the snapshot, no API calls)
- Mode: single rendering per call (per-language lower bound; production may supply several renderings)
- Register scoring: gold tier to required register, casual to informal, polite and formal to formal, neutral to neutral

## Accuracy by field

| Field | Correct | Labeled | Accuracy |
|---|---|---|---|
| register | 142 | 143 | 99.3% |
| addresseeNumber | 199 | 199 | 100.0% |
| speakerGender | 541 | 548 | 98.7% |
| addresseeGender | 205 | 205 | 100.0% |
| addressesSomeone | 212 | 212 | 100.0% |
| referentGender | 17 | 17 | 100.0% |

## speakerGender by language

| Language | Correct | Total | Accuracy |
|---|---|---|---|
| ar | 17 | 17 | 100.0% |
| ar_eg | 8 | 8 | 100.0% |
| ar_iq | 6 | 6 | 100.0% |
| ar_lev | 8 | 8 | 100.0% |
| ar_sa | 6 | 6 | 100.0% |
| bg | 17 | 17 | 100.0% |
| ca | 13 | 15 | 86.7% |
| cs | 17 | 17 | 100.0% |
| de | 8 | 8 | 100.0% |
| el | 16 | 16 | 100.0% |
| en | 47 | 47 | 100.0% |
| es | 17 | 17 | 100.0% |
| fi | 7 | 7 | 100.0% |
| fr | 15 | 16 | 93.8% |
| he | 17 | 17 | 100.0% |
| hi | 16 | 17 | 94.1% |
| hr | 17 | 17 | 100.0% |
| id | 8 | 8 | 100.0% |
| is | 16 | 16 | 100.0% |
| it | 17 | 17 | 100.0% |
| ja | 14 | 14 | 100.0% |
| ko | 14 | 14 | 100.0% |
| lt | 17 | 17 | 100.0% |
| lv | 17 | 17 | 100.0% |
| pl | 17 | 17 | 100.0% |
| pt | 17 | 17 | 100.0% |
| pt_pt | 9 | 9 | 100.0% |
| ro | 15 | 15 | 100.0% |
| ru | 17 | 17 | 100.0% |
| sk | 17 | 17 | 100.0% |
| sl | 17 | 17 | 100.0% |
| sr | 17 | 17 | 100.0% |
| th | 14 | 15 | 93.3% |
| tr | 7 | 7 | 100.0% |
| uk | 17 | 17 | 100.0% |
| vi | 15 | 16 | 93.8% |
| zh | 7 | 8 | 87.5% |

## register by language

| Language | Correct | Total | Accuracy |
|---|---|---|---|
| de | 14 | 14 | 100.0% |
| es | 14 | 14 | 100.0% |
| fr | 14 | 14 | 100.0% |
| hi | 14 | 14 | 100.0% |
| ja | 15 | 16 | 93.8% |
| ko | 16 | 16 | 100.0% |
| pt | 14 | 14 | 100.0% |
| ru | 14 | 14 | 100.0% |
| th | 13 | 13 | 100.0% |
| zh | 14 | 14 | 100.0% |

## Confusion (expected → got)

**register**

- formal → formal: 60, neutral: 1
- informal → informal: 52
- neutral → neutral: 30

**addresseeNumber**

- singular → singular: 65
- plural → plural: 2
- not_applicable → not_applicable: 132

**speakerGender**

- male → male: 142, neutral: 3
- female → female: 149
- neutral → female: 2, male: 2, neutral: 250

**addresseeGender**

- male → male: 1
- female → female: 28
- neutral → neutral: 44
- not_applicable → not_applicable: 132

**addressesSomeone**

- true → true: 80
- false → false: 132

**referentGender**

- male → male: 7
- female → female: 7
- neutral → neutral: 3

## Misclassified (8)

| Field | Language | Sentence | Expected | Got | Phenomenon |
|---|---|---|---|---|---|
| speakerGender | ca | Estic content. | male | neutral | predicate-adjective |
| speakerGender | ca | Estic trist. | male | neutral | predicate-adjective |
| speakerGender | fr | Je suis content. | male | neutral | predicate-adjective |
| speakerGender | hi | उसने कहा, "मैं थक गई हूँ।" | neutral | female | quoted-speech |
| speakerGender | th | เขาบอกว่า “ผมหิวข้าวครับ” | neutral | male | quoted-speech |
| speakerGender | vi | Nam nói: “Anh yêu em.” | neutral | male | quoted-speech |
| speakerGender | zh | 我丈夫是老师。 | neutral | female | referent-not-speaker |
| register | ja | 彼は「もう帰るぞ」と言っていました。 | formal | neutral | quoted-speech |

## Snapshot diff

Not applicable: this report re-scored the snapshot itself.
