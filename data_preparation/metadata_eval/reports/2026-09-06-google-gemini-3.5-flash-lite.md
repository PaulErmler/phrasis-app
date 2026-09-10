# Sentence-metadata classifier eval — 2026-09-06

- Model: `google/gemini-3.5-flash-lite`
- Prompt: `convex/lib/sentenceMetadataPrompt.ts` at this commit
- Entries: 651 (one API call each, all five fields)
- Run cost: $0.2879
- Mode: single rendering per call (per-language lower bound; production may supply several renderings)
- Register scoring: gold tier to required register, casual to informal, polite and formal to formal, neutral to neutral

## Accuracy by field

| Field | Correct | Labeled | Accuracy |
|---|---|---|---|
| register | 133 | 143 | 93.0% |
| addresseeNumber | 195 | 195 | 100.0% |
| speakerGender | 500 | 508 | 98.4% |
| addresseeGender | 201 | 201 | 100.0% |
| addressesSomeone | 208 | 208 | 100.0% |

## speakerGender by language

| Language | Correct | Total | Accuracy |
|---|---|---|---|
| ar | 16 | 17 | 94.1% |
| ar_eg | 8 | 8 | 100.0% |
| ar_iq | 6 | 6 | 100.0% |
| ar_lev | 7 | 8 | 87.5% |
| ar_sa | 6 | 6 | 100.0% |
| bg | 17 | 17 | 100.0% |
| ca | 14 | 15 | 93.3% |
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
| fr | 13 | 14 | 92.9% |
| hi | 13 | 14 | 92.9% |
| ja | 14 | 16 | 87.5% |
| ko | 13 | 16 | 81.3% |
| pt | 14 | 14 | 100.0% |
| ru | 14 | 14 | 100.0% |
| th | 10 | 13 | 76.9% |
| zh | 14 | 14 | 100.0% |

## Confusion (expected → got)

**register**

- formal → formal: 51, informal: 6, neutral: 4
- informal → informal: 52
- neutral → neutral: 30

**addresseeNumber**

- singular → singular: 62
- plural → plural: 1
- not_applicable → not_applicable: 132

**speakerGender**

- male → male: 133, neutral: 4
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

## Misclassified (18)

| Field | Language | Sentence | Expected | Got | Phenomenon |
|---|---|---|---|---|---|
| speakerGender | ar | أنا جائع. | male | neutral | predicate-adjective |
| speakerGender | ar_lev | أنا جوعان. | male | neutral | predicate-adjective |
| speakerGender | ca | Estic trist. | male | neutral | predicate-adjective |
| speakerGender | fr | Je suis content. | male | neutral | predicate-adjective |
| speakerGender | id | Suami saya seorang guru. | neutral | female | referent-not-speaker |
| speakerGender | ko | 언니는 요리를 잘해요. | female | neutral | kinship-term |
| speakerGender | th | เขาบอกว่า “ผมหิวข้าวครับ” | neutral | male | quoted-speech |
| speakerGender | zh | 我丈夫是老师。 | neutral | female | referent-not-speaker |
| register | fr | Dites-lui simplement : “appelle-moi demain”. | formal | neutral | quoted-speech |
| register | hi | उनसे कहिए: “मुझे कल फ़ोन करो”। | formal | neutral | quoted-speech |
| register | ja | この本はとても面白いですよ。 | formal | informal | sentence-final-style |
| register | ja | 彼は「もう帰るぞ」と言っていました。 | formal | neutral | quoted-speech |
| register | ko | 내일 다시 전화할게요. | formal | informal | speech-level |
| register | ko | 지금 가요. | formal | informal | speech-level |
| register | ko | 동생이 “빨리 와!”라고 했어요. | formal | neutral | quoted-speech |
| register | th | ขอบคุณมากครับ | formal | informal | polite-particle |
| register | th | ขอบคุณมากค่ะ | formal | informal | polite-particle |
| register | th | เชิญนั่งก่อนนะคะ | formal | informal | polite-particle |

## Snapshot diff

37 field answer(s) moved. "Gold" is blank where the field is unlabeled — those rows say the answer changed, not that it is wrong.

| Field | Language | Sentence | Before | After | Gold |
|---|---|---|---|---|---|
| register | ar_lev | أنا مبسوط. | neutral | informal |  |
| addresseeGender | cs | Zeptal se: „Jsi unavená?“ | neutral | female |  |
| speakerGender | en | My husband is a good cook. | female | neutral | neutral |
| register | hi | मैं रोज़ काम करती हूँ। | neutral | informal |  |
| addresseeGender | hr | Pitao je: „Jesi li umorna?“ | neutral | female |  |
| addressesSomeone | hr | Pitao je: „Jesi li umorna?“ | false | true |  |
| register | ja | 田中さんは毎朝コーヒーを飲みます。 | neutral | formal |  |
| addresseeGender | ko | 형, 같이 가요. | neutral | male |  |
| register | ko | 우리 오빠는 대학생이에요. | neutral | informal |  |
| addressesSomeone | lv | Viņš jautāja: „Vai tu esi nogurusi?” | true | false |  |
| register | pt | Estou cansado. | neutral | informal |  |
| register | pt | Obrigado! | neutral | informal |  |
| speakerGender | pt | Sou brasileiro. | neutral | male | male |
| register | pt_pt | Obrigado! | neutral | informal |  |
| addresseeNumber | pt_pt | Obrigado! | not_applicable | singular |  |
| register | pt_pt | Estou triste. | informal | neutral |  |
| addresseeGender | sl | Vprašal je: »Ali si utrujena?« | neutral | female |  |
| addressesSomeone | sl | Vprašal je: »Ali si utrujena?« | false | true |  |
| addresseeGender | sr | Питао је: „Јеси ли уморна?“ | female | not_applicable |  |
| addresseeNumber | th | ขอบคุณค่ะ | singular | not_applicable |  |
| addresseeGender | th | ขอบคุณค่ะ | neutral | not_applicable |  |
| addressesSomeone | th | ขอบคุณค่ะ | true | false |  |
| register | th | สวัสดีค่ะ | neutral | formal |  |
| register | th | พรุ่งนี้จะไปตลาด | neutral | informal |  |
| addresseeNumber | fr | Est-ce que vous pourriez répéter, s'il vous plaît ? | singular | plural |  |
| register | fr | Dites-lui simplement : “appelle-moi demain”. | formal | neutral | formal |
| register | hi | उनसे कहिए: “मुझे कल फ़ोन करो”। | informal | neutral | formal |
| addresseeNumber | ja | そんなの知らないよ。 | singular | not_applicable |  |
| addresseeGender | ja | そんなの知らないよ。 | neutral | not_applicable |  |
| addressesSomeone | ja | そんなの知らないよ。 | true | false |  |
| register | ko | 내일 다시 전화할게요. | formal | informal | formal |
| addresseeNumber | ko | 내일 다시 전화할게요. | singular | not_applicable |  |
| addresseeGender | ko | 내일 다시 전화할게요. | neutral | not_applicable |  |
| addressesSomeone | ko | 내일 다시 전화할게요. | true | false |  |
| addresseeNumber | ru | Скажите, пожалуйста, который час? | singular | plural |  |
| speakerGender | th | เธอจะไปกับฉันไหม | neutral | female |  |
| register | th | คุณหมอจะมาถึงกี่โมงคะ | neutral | formal | formal |
