# Sentence-metadata classifier eval — 2026-09-06

- Model: `google/gemini-3.1-flash-lite`
- Prompt: `convex/lib/sentenceMetadataPrompt.ts` at this commit
- Entries: 651 (one API call each, all five fields)
- Run cost: $0.2200
- Mode: single rendering per call (per-language lower bound; production may supply several renderings)
- Register scoring: gold tier to required register, casual to informal, polite and formal to formal, neutral to neutral

## Accuracy by field

| Field | Correct | Labeled | Accuracy |
|---|---|---|---|
| register | 141 | 143 | 98.6% |
| addresseeNumber | 195 | 195 | 100.0% |
| speakerGender | 501 | 508 | 98.6% |
| addresseeGender | 201 | 201 | 100.0% |
| addressesSomeone | 208 | 208 | 100.0% |

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
| en | 7 | 7 | 100.0% |
| es | 17 | 17 | 100.0% |
| fi | 7 | 7 | 100.0% |
| fr | 15 | 16 | 93.8% |
| he | 17 | 17 | 100.0% |
| hi | 17 | 17 | 100.0% |
| hr | 17 | 17 | 100.0% |
| id | 7 | 8 | 87.5% |
| is | 16 | 16 | 100.0% |
| it | 17 | 17 | 100.0% |
| ja | 14 | 14 | 100.0% |
| ko | 13 | 14 | 92.9% |
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
| vi | 16 | 16 | 100.0% |
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
| th | 12 | 13 | 92.3% |
| zh | 14 | 14 | 100.0% |

## Confusion (expected → got)

**register**

- formal → formal: 59, invalid: 1, neutral: 1
- informal → informal: 52
- neutral → neutral: 30

**addresseeNumber**

- singular → singular: 62
- plural → plural: 1
- not_applicable → not_applicable: 132

**speakerGender**

- male → male: 134, neutral: 3
- female → female: 138, neutral: 1
- neutral → female: 2, male: 1, neutral: 229

**addresseeGender**

- male → (none)
- female → female: 26
- neutral → neutral: 43
- not_applicable → not_applicable: 132

**addressesSomeone**

- true → true: 76
- false → false: 132

## Misclassified (9)

| Field | Language | Sentence | Expected | Got | Phenomenon |
|---|---|---|---|---|---|
| speakerGender | ca | Estic content. | male | neutral | predicate-adjective |
| speakerGender | ca | Estic trist. | male | neutral | predicate-adjective |
| speakerGender | fr | Je suis content. | male | neutral | predicate-adjective |
| speakerGender | id | Suami saya seorang guru. | neutral | female | referent-not-speaker |
| speakerGender | ko | 언니는 요리를 잘해요. | female | neutral | kinship-term |
| speakerGender | th | เขาบอกว่า “ผมหิวข้าวครับ” | neutral | male | quoted-speech |
| speakerGender | zh | 我丈夫是老师。 | neutral | female | referent-not-speaker |
| register | ja | 彼は「もう帰るぞ」と言っていました。 | formal | neutral | quoted-speech |
| register | th | ท่านประธานกำลังรับประทานอาหารกลางวันอยู่ครับ | formal | invalid | honorific-verb |

## Snapshot diff

21 field answer(s) moved. "Gold" is blank where the field is unlabeled — those rows say the answer changed, not that it is wrong.

| Field | Language | Sentence | Before | After | Gold |
|---|---|---|---|---|---|
| speakerGender | hi | उसने कहा, "मैं थक गई हूँ।" | female | neutral | neutral |
| register | ja | 弟は「俺は行くぜ」と言いました。 | informal | neutral |  |
| register | pt_pt | Obrigada! | informal | neutral |  |
| addresseeNumber | th | ขอบคุณครับ | singular | not_applicable |  |
| addresseeGender | th | ขอบคุณครับ | neutral | not_applicable |  |
| addressesSomeone | th | ขอบคุณครับ | true | false |  |
| register | th | ผมเป็นครู | neutral | formal |  |
| speakerGender | vi | Nam nói: “Anh yêu em.” | male | neutral | neutral |
| addresseeGender | vi | Nam nói: “Anh yêu em.” | female | neutral |  |
| addressesSomeone | vi | Nam nói: “Anh yêu em.” | true | false |  |
| addresseeNumber | fr | Pourriez-vous m'aider, s'il vous plaît ? | singular | plural |  |
| addresseeNumber | ja | そんなの知らないよ。 | not_applicable | singular |  |
| addresseeGender | ja | そんなの知らないよ。 | not_applicable | neutral |  |
| addressesSomeone | ja | そんなの知らないよ。 | false | true |  |
| register | ja | 彼は「もう帰るぞ」と言っていました。 | informal | neutral | formal |
| addresseeGender | th | เธอจะไปกับฉันไหม | female | neutral |  |
| register | th | ท่านประธานกำลังรับประทานอาหารกลางวันอยู่ครับ | formal | invalid | formal |
| addresseeNumber | th | ท่านประธานกำลังรับประทานอาหารกลางวันอยู่ครับ | not_applicable | invalid |  |
| speakerGender | th | ท่านประธานกำลังรับประทานอาหารกลางวันอยู่ครับ | male | invalid |  |
| addresseeGender | th | ท่านประธานกำลังรับประทานอาหารกลางวันอยู่ครับ | not_applicable | invalid |  |
| addressesSomeone | th | ท่านประธานกำลังรับประทานอาหารกลางวันอยู่ครับ | false | invalid |  |
