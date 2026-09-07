/**
 * Probe sentences for the real-engine IPA audit in tests/node/espeak-ipa.test.ts.
 *
 * Four sentences per language, deliberately varied (greeting, statement with a
 * place name, past-tense clause, question) so a voice that only handles its
 * dictionary's greetings still gets caught. Keyed by app language code rather
 * than espeak voice, so a language pointed at the wrong voice fails too.
 *
 * The audit test asserts every member of IPA_LANGUAGES has an entry here. That
 * is intentional: adding an `ipaVoice` to lib/languages.ts should force you to
 * supply sentences and see what the voice actually produces. The Sep 2026
 * removals (th, he, ar, zh, yue, vi, ko) were all found this way, after a
 * user reported Thai coming out as "sˈa5wmsaɜds".
 */
export const IPA_PROBE_SENTENCES: Record<string, readonly string[]> = {
  en: [
    'Hello there',
    'I live in New York',
    'She went to the market yesterday',
    'What time is it?',
  ],
  en_us: [
    'Hello there',
    'I live in New York',
    'She went to the market yesterday',
    'What time is it?',
  ],
  en_gb: [
    'Hello there',
    'I live in London',
    'She went to the market yesterday',
    'What time is it?',
  ],
  en_au: [
    'Hello there',
    'I live in Sydney',
    'She went to the market yesterday',
    'What time is it?',
  ],
  es: [
    'Hola, buenos días',
    'Vivo en Madrid',
    'Ella fue al mercado ayer',
    '¿Qué hora es?',
  ],
  es_latam: [
    'Hola, buenos días',
    'Vivo en Bogotá',
    'Ella fue al mercado ayer',
    '¿Qué hora es?',
  ],
  es_mixed: [
    'Hola, buenos días',
    'Vivo en Lima',
    'Ella fue al mercado ayer',
    '¿Qué hora es?',
  ],
  fr: [
    'Bonjour tout le monde',
    'J’habite à Paris',
    'Elle est allée au marché hier',
    'Quelle heure est-il ?',
  ],
  de: [
    'Guten Tag zusammen',
    'Ich wohne in Berlin',
    'Sie ging gestern zum Markt',
    'Wie spät ist es?',
  ],
  it: [
    'Buongiorno a tutti',
    'Abito a Roma',
    'È andata al mercato ieri',
    'Che ore sono?',
  ],
  pt: [
    'Bom dia a todos',
    'Eu moro em São Paulo',
    'Ela foi ao mercado ontem',
    'Que horas são?',
  ],
  pt_pt: [
    'Bom dia a todos',
    'Eu moro em Lisboa',
    'Ela foi ao mercado ontem',
    'Que horas são?',
  ],
  ro: [
    'Bună ziua tuturor',
    'Locuiesc în București',
    'Ea a mers ieri la piață',
    'Cât e ceasul?',
  ],
  ca: [
    'Bon dia a tothom',
    'Visc a Barcelona',
    'Va anar al mercat ahir',
    'Quina hora és?',
  ],
  ru: [
    'Здравствуйте',
    'Я живу в Москве',
    'Она вчера ходила на рынок',
    'Который час?',
  ],
  pl: [
    'Dzień dobry wszystkim',
    'Mieszkam w Warszawie',
    'Wczoraj poszła na targ',
    'Która godzina?',
  ],
  sk: [
    'Dobrý deň všetkým',
    'Bývam v Bratislave',
    'Včera išla na trh',
    'Koľko je hodín?',
  ],
  cs: [
    'Dobrý den všem',
    'Bydlím v Praze',
    'Včera šla na trh',
    'Kolik je hodin?',
  ],
  hr: [
    'Dobar dan svima',
    'Živim u Zagrebu',
    'Jučer je išla na tržnicu',
    'Koliko je sati?',
  ],
  sl: [
    'Dober dan vsem',
    'Živim v Ljubljani',
    'Včeraj je šla na tržnico',
    'Koliko je ura?',
  ],
  uk: [
    'Доброго дня',
    'Я живу в Києві',
    'Вона вчора ходила на ринок',
    'Котра година?',
  ],
  sr: [
    'Добар дан свима',
    'Живим у Београду',
    'Јуче је ишла на пијацу',
    'Колико је сати?',
  ],
  bg: [
    'Добър ден на всички',
    'Живея в София',
    'Вчера отиде на пазара',
    'Колко е часът?',
  ],
  lt: [
    'Laba diena visiems',
    'Gyvenu Vilniuje',
    'Vakar ji ėjo į turgų',
    'Kiek valandų?',
  ],
  lv: [
    'Labdien visiem',
    'Es dzīvoju Rīgā',
    'Vakar viņa gāja uz tirgu',
    'Cik ir pulkstenis?',
  ],
  et: [
    'Tere kõigile',
    'Ma elan Tallinnas',
    'Ta käis eile turul',
    'Mis kell on?',
  ],
  nl: [
    'Goedendag allemaal',
    'Ik woon in Amsterdam',
    'Ze ging gisteren naar de markt',
    'Hoe laat is het?',
  ],
  sv: [
    'God dag allihopa',
    'Jag bor i Stockholm',
    'Hon gick till marknaden igår',
    'Vad är klockan?',
  ],
  nb: [
    'God dag alle sammen',
    'Jeg bor i Oslo',
    'Hun gikk på markedet i går',
    'Hva er klokka?',
  ],
  da: [
    'Goddag allesammen',
    'Jeg bor i København',
    'Hun gik på markedet i går',
    'Hvad er klokken?',
  ],
  is: [
    'Góðan daginn öll',
    'Ég bý í Reykjavík',
    'Hún fór á markaðinn í gær',
    'Hvað er klukkan?',
  ],
  fi: [
    'Hyvää päivää kaikille',
    'Asun Helsingissä',
    'Hän meni eilen torille',
    'Paljonko kello on?',
  ],
  el: [
    'Καλημέρα σε όλους',
    'Μένω στην Αθήνα',
    'Πήγε χθες στην αγορά',
    'Τι ώρα είναι;',
  ],
  hi: [
    'नमस्ते सब लोग',
    'मैं दिल्ली में रहता हूँ',
    'वह कल बाज़ार गई',
    'कितने बजे हैं?',
  ],
  bn: [
    'সবাইকে নমস্কার',
    'আমি ঢাকায় থাকি',
    'সে গতকাল বাজারে গিয়েছিল',
    'কয়টা বাজে?',
  ],
  ta: [
    'அனைவருக்கும் வணக்கம்',
    'நான் சென்னையில் வசிக்கிறேன்',
    'அவள் நேற்று சந்தைக்குச் சென்றாள்',
    'மணி என்ன?',
  ],
  te: [
    'అందరికీ నమస్కారం',
    'నేను హైదరాబాద్‌లో ఉంటాను',
    'ఆమె నిన్న మార్కెట్‌కి వెళ్ళింది',
    'ఇప్పుడు టైం ఎంత?',
  ],
  tr: [
    'Herkese merhaba',
    'İstanbul’da yaşıyorum',
    'Dün pazara gitti',
    'Saat kaç?',
  ],
  uz: [
    'Hammaga salom',
    'Men Toshkentda yashayman',
    'U kecha bozorga bordi',
    'Soat necha?',
  ],
  hu: [
    'Jó napot mindenkinek',
    'Budapesten lakom',
    'Tegnap elment a piacra',
    'Hány óra van?',
  ],
  id: [
    'Halo semuanya',
    'Saya tinggal di Jakarta',
    'Dia pergi ke pasar kemarin',
    'Jam berapa sekarang?',
  ],
  ms: [
    'Helo semua',
    'Saya tinggal di Kuala Lumpur',
    'Dia pergi ke pasar semalam',
    'Pukul berapa sekarang?',
  ],
  fa: [
    'سلام به همه',
    'من در تهران زندگی می‌کنم',
    'او دیروز به بازار رفت',
    'ساعت چند است؟',
  ],
  sw: [
    'Habari zenu nyote',
    'Ninaishi Nairobi',
    'Alienda sokoni jana',
    'Ni saa ngapi sasa?',
  ],
  sw_tz: [
    'Habari zenu nyote',
    'Ninaishi Dar es Salaam',
    'Alienda sokoni jana',
    'Ni saa ngapi sasa?',
  ],
};
