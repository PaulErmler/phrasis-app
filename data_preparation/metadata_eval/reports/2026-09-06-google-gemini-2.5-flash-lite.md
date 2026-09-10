# Sentence-metadata classifier eval — 2026-09-06

- Model: `google/gemini-2.5-flash-lite`
- Prompt: `convex/lib/sentenceMetadataPrompt.ts` at this commit
- Entries: 651 (one API call each, all five fields)
- Run cost: $0.0826
- Mode: single rendering per call (per-language lower bound; production may supply several renderings)
- Register scoring: gold tier to required register, casual to informal, polite and formal to formal, neutral to neutral

## Accuracy by field

| Field | Correct | Labeled | Accuracy |
|---|---|---|---|
| register | 131 | 143 | 91.6% |
| addresseeNumber | 195 | 195 | 100.0% |
| speakerGender | 448 | 508 | 88.2% |
| addresseeGender | 193 | 201 | 96.0% |
| addressesSomeone | 208 | 208 | 100.0% |

## speakerGender by language

| Language | Correct | Total | Accuracy |
|---|---|---|---|
| ar | 14 | 17 | 82.4% |
| ar_eg | 7 | 8 | 87.5% |
| ar_iq | 6 | 6 | 100.0% |
| ar_lev | 7 | 8 | 87.5% |
| ar_sa | 4 | 6 | 66.7% |
| bg | 15 | 17 | 88.2% |
| ca | 14 | 15 | 93.3% |
| cs | 15 | 17 | 88.2% |
| de | 8 | 8 | 100.0% |
| el | 14 | 16 | 87.5% |
| en | 7 | 7 | 100.0% |
| es | 16 | 17 | 94.1% |
| fi | 6 | 7 | 85.7% |
| fr | 15 | 16 | 93.8% |
| he | 13 | 17 | 76.5% |
| hi | 13 | 17 | 76.5% |
| hr | 15 | 17 | 88.2% |
| id | 6 | 8 | 75.0% |
| is | 14 | 16 | 87.5% |
| it | 16 | 17 | 94.1% |
| ja | 12 | 14 | 85.7% |
| ko | 10 | 14 | 71.4% |
| lt | 16 | 17 | 94.1% |
| lv | 16 | 17 | 94.1% |
| pl | 15 | 17 | 88.2% |
| pt | 14 | 17 | 82.4% |
| pt_pt | 8 | 9 | 88.9% |
| ro | 13 | 15 | 86.7% |
| ru | 16 | 17 | 94.1% |
| sk | 16 | 17 | 94.1% |
| sl | 15 | 17 | 88.2% |
| sr | 15 | 17 | 88.2% |
| th | 13 | 15 | 86.7% |
| tr | 7 | 7 | 100.0% |
| uk | 16 | 17 | 94.1% |
| vi | 13 | 16 | 81.3% |
| zh | 8 | 8 | 100.0% |

## register by language

| Language | Correct | Total | Accuracy |
|---|---|---|---|
| de | 13 | 14 | 92.9% |
| es | 14 | 14 | 100.0% |
| fr | 14 | 14 | 100.0% |
| hi | 14 | 14 | 100.0% |
| ja | 12 | 16 | 75.0% |
| ko | 12 | 16 | 75.0% |
| pt | 13 | 14 | 92.9% |
| ru | 14 | 14 | 100.0% |
| th | 12 | 13 | 92.3% |
| zh | 13 | 14 | 92.9% |

## Confusion (expected → got)

**register**

- formal → formal: 53, informal: 2, neutral: 6
- informal → formal: 1, informal: 48, neutral: 3
- neutral → neutral: 30

**addresseeNumber**

- singular → singular: 62
- plural → plural: 1
- not_applicable → not_applicable: 132

**speakerGender**

- male → female: 1, male: 133, neutral: 3
- female → female: 137, male: 1, neutral: 1
- neutral → female: 42, male: 12, neutral: 178

**addresseeGender**

- male → (none)
- female → female: 18, neutral: 8
- neutral → neutral: 43
- not_applicable → not_applicable: 132

**addressesSomeone**

- true → true: 76
- false → false: 132

## Misclassified (80)

| Field | Language | Sentence | Expected | Got | Phenomenon |
|---|---|---|---|---|---|
| speakerGender | ar | هي متعبة. | neutral | female | none-third-person |
| speakerGender | ar | أختي سعيدة. | neutral | female | referent-not-speaker |
| speakerGender | ar | قالت: «أنا متعبة». | neutral | female | quoted-speech |
| speakerGender | ar_eg | عاملة إيه؟ | neutral | female | addressee-not-speaker |
| addresseeGender | ar_eg | عاملة إيه؟ | female | neutral | addressee-not-speaker |
| speakerGender | ar_lev | هي تعبانة. | neutral | female | none-third-person |
| speakerGender | ar_sa | هو تعبان. | neutral | male | none-third-person |
| speakerGender | ar_sa | هي فرحانة. | neutral | female | none-third-person |
| speakerGender | bg | Казах, че ще дойда. | neutral | male | verb-agreement |
| speakerGender | bg | Сестра ми каза, че е уморена. | neutral | female | referent-not-speaker |
| speakerGender | ca | Ella va dir: «Estic cansada». | neutral | female | quoted-speech |
| speakerGender | cs | Řekla jsi, že přijdeš. | neutral | female | addressee-not-speaker |
| addresseeGender | cs | Řekla jsi, že přijdeš. | female | neutral | addressee-not-speaker |
| speakerGender | cs | Moje sestra byla unavená. | neutral | female | referent-not-speaker |
| speakerGender | el | Η αδερφή μου είναι κουρασμένη. | neutral | female | referent-not-speaker |
| speakerGender | el | Η Μαρία είπε: «Είμαι κουρασμένη». | neutral | female | quoted-speech |
| speakerGender | es | Mi hermana está cansada. | neutral | female | referent-not-speaker |
| speakerGender | fi | Veljeni asuu Helsingissä. | neutral | male | referent-not-speaker |
| speakerGender | fr | Ma sœur est fatiguée. | neutral | female | referent-not-speaker |
| speakerGender | he | הוא עובד כל יום. | neutral | male | none-third-person |
| speakerGender | he | היא עייפה מאוד. | neutral | female | none-third-person |
| speakerGender | he | אחותי רופאה. | neutral | female | referent-not-speaker |
| speakerGender | he | היא אמרה: "אני עייפה." | neutral | female | quoted-speech |
| speakerGender | hi | वह रोज़ काम करता है। | neutral | male | none-third-person |
| speakerGender | hi | वह बहुत थकी हुई है। | neutral | female | none-third-person |
| speakerGender | hi | मेरी बहन डॉक्टर है। | neutral | female | referent-not-speaker |
| speakerGender | hi | उसने कहा, "मैं थक गई हूँ।" | neutral | female | quoted-speech |
| speakerGender | hr | Rekla si da ćeš doći. | neutral | female | addressee-not-speaker |
| addresseeGender | hr | Rekla si da ćeš doći. | female | neutral | addressee-not-speaker |
| speakerGender | hr | Moja sestra je bila umorna. | neutral | female | referent-not-speaker |
| speakerGender | id | Kakak perempuan saya lelah. | neutral | female | referent-not-speaker |
| speakerGender | id | Ibu saya suka memasak. | neutral | female | referent-not-speaker |
| speakerGender | is | Ég er svöng. | female | neutral | predicate-adjective |
| addresseeGender | is | Ertu þreytt? | female | neutral | addressee-not-speaker |
| speakerGender | is | Hún sagði: „Ég er þreytt“. | neutral | female | quoted-speech |
| speakerGender | it | Maria ha detto: «Sono stanca». | neutral | female | quoted-speech |
| speakerGender | ja | 早く行こうぜ。 | male | neutral | polite-particle |
| speakerGender | ja | 弟は「俺は行くぜ」と言いました。 | neutral | male | quoted-speech |
| speakerGender | ko | 누나가 보고 싶어요. | male | female | kinship-term |
| speakerGender | ko | 우리 오빠는 대학생이에요. | female | male | kinship-term |
| speakerGender | ko | 수미는 “오빠가 보고 싶어요”라고 말했어요. | neutral | female | quoted-speech |
| speakerGender | ko | 수미의 오빠는 의사예요. | neutral | male | referent-not-speaker |
| speakerGender | lt | Mano sesuo yra pavargusi. | neutral | female | referent-not-speaker |
| speakerGender | lv | Mana māsa ir nogurusi. | neutral | female | referent-not-speaker |
| speakerGender | pl | Powiedziałaś, że przyjdziesz. | neutral | female | addressee-not-speaker |
| addresseeGender | pl | Powiedziałaś, że przyjdziesz. | female | neutral | addressee-not-speaker |
| speakerGender | pl | Moja siostra była zmęczona. | neutral | female | referent-not-speaker |
| speakerGender | pt | Obrigado! | male | neutral | thanks-form |
| speakerGender | pt | Minha irmã está cansada. | neutral | female | referent-not-speaker |
| speakerGender | pt | Ela disse: “Estou cansada”. | neutral | female | quoted-speech |
| speakerGender | pt_pt | Obrigado! | male | neutral | thanks-form |
| speakerGender | ro | Sora mea este obosită. | neutral | female | referent-not-speaker |
| speakerGender | ro | Ea a spus: „Sunt obosită”. | neutral | female | quoted-speech |
| speakerGender | ru | Моя сестра сказала, что устала. | neutral | female | referent-not-speaker |
| speakerGender | sk | Moja sestra bola unavená. | neutral | female | referent-not-speaker |
| speakerGender | sl | Povedala si resnico. | neutral | female | addressee-not-speaker |
| addresseeGender | sl | Povedala si resnico. | female | neutral | addressee-not-speaker |
| speakerGender | sl | Vprašal je: »Ali si utrujena?« | neutral | male | quoted-speech |
| speakerGender | sr | Рекла си да ћеш доћи. | neutral | female | addressee-not-speaker |
| addresseeGender | sr | Рекла си да ћеш доћи. | female | neutral | addressee-not-speaker |
| speakerGender | sr | Питао је: „Јеси ли уморна?“ | neutral | male | quoted-speech |
| speakerGender | th | เขาบอกว่า “ผมหิวข้าวครับ” | neutral | male | quoted-speech |
| speakerGender | th | พี่สาวทำงานที่โรงพยาบาล | neutral | female | referent-not-speaker |
| speakerGender | uk | Моя сестра сказала, що втомилася. | neutral | female | referent-not-speaker |
| speakerGender | vi | Anh trai tôi rất cao. | neutral | male | referent-not-speaker |
| speakerGender | vi | Chị có khỏe không? | neutral | female | addressee-not-speaker |
| addresseeGender | vi | Chị có khỏe không? | female | neutral | addressee-not-speaker |
| speakerGender | vi | Nam nói: “Anh yêu em.” | neutral | male | quoted-speech |
| register | de | Danke schön! Ohne dich hätte ich das nie geschafft. | informal | formal | fossilized-formula |
| register | ja | 明日の会議は十時に始まります。 | formal | neutral | sentence-final-style |
| register | ja | この本はとても面白いですよ。 | formal | neutral | sentence-final-style |
| register | ja | 週末は何をしますか。 | formal | neutral | sentence-final-style |
| register | ja | 彼は「もう帰るぞ」と言っていました。 | formal | neutral | quoted-speech |
| register | ko | 주말에 뭐 해요? | formal | informal | speech-level |
| register | ko | 지금 가요. | formal | neutral | speech-level |
| register | ko | 지금 갑니다. | formal | neutral | speech-level |
| register | ko | 동생이 “빨리 와!”라고 했어요. | formal | informal | quoted-speech |
| register | pt | Muito obrigado! Você me salvou hoje. | informal | neutral | fossilized-formula |
| register | th | เธอจะไปกับฉันไหม | informal | neutral | tv-pronoun |
| register | zh | 你吃饭了吗? | informal | neutral | tv-pronoun |

## Snapshot diff

No snapshot recorded for this model yet.
