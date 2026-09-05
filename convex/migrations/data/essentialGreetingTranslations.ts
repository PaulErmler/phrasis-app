/**
 * Hand-curated translations for the first three L01 ("Essential") sentences.
 *
 * Why curated instead of the LLM pipeline: these are the very first sentences
 * every new user sees during onboarding, and the previous pair ("Hi." /
 * "Hello!") collapsed to the same word in many languages, making the first
 * reps confusing. The replacement trio is uploaded with fixed, reviewed
 * translations so the first impression never depends on a pipeline roll.
 *
 * Conventions:
 *   - Register is informal (tú/du/tu…), matching the texts rows' register.
 *   - Languages whose "How are you?" inflects for addressee gender (Arabic
 *     dialects, Hebrew, Hindi) use the conventional masculine-singular
 *     textbook form.
 *   - No romanization is curated here: the app's romanization pipeline
 *     generates it automatically for languages that need it.
 *   - `helloHowAreYou` is the natural per-language join of the two parts.
 *     Stored explicitly because joining rules differ (Thai spacing, CJK
 *     punctuation, Greek question mark).
 */

export type CuratedSentenceTranslation = {
  text: string;
};

export type CuratedGreetingEntry = {
  hello: CuratedSentenceTranslation;
  howAreYou: CuratedSentenceTranslation;
  helloHowAreYou: CuratedSentenceTranslation;
  /** Concrete variant for mixed codes (today only es_mixed → 'es-ES'). */
  regionVariant?: string;
};

/** English source texts, keyed by the OGTE externalId of the row they replace. */
export const ESSENTIAL_GREETING_SENTENCES = [
  { externalId: '538123', key: 'hello', text: 'Hello.' },
  { externalId: '373330', key: 'howAreYou', text: 'How are you?' },
  { externalId: '30316', key: 'helloHowAreYou', text: 'Hello. How are you?' },
] as const;

export const ESSENTIAL_GREETING_TRANSLATIONS: Record<
  string,
  CuratedGreetingEntry
> = {
  // English variants are hidden from the picker but can appear as base or
  // target languages; the "translation" is the identical English text.
  en_gb: {
    hello: { text: 'Hello.' },
    howAreYou: { text: 'How are you?' },
    helloHowAreYou: { text: 'Hello. How are you?' },
  },
  en_us: {
    hello: { text: 'Hello.' },
    howAreYou: { text: 'How are you?' },
    helloHowAreYou: { text: 'Hello. How are you?' },
  },
  en_au: {
    hello: { text: 'Hello.' },
    howAreYou: { text: 'How are you?' },
    helloHowAreYou: { text: 'Hello. How are you?' },
  },
  es: {
    hello: { text: 'Hola.' },
    howAreYou: { text: '¿Cómo estás?' },
    helloHowAreYou: { text: 'Hola. ¿Cómo estás?' },
  },
  es_latam: {
    hello: { text: 'Hola.' },
    howAreYou: { text: '¿Cómo estás?' },
    helloHowAreYou: { text: 'Hola. ¿Cómo estás?' },
  },
  es_mixed: {
    hello: { text: 'Hola.' },
    howAreYou: { text: '¿Cómo estás?' },
    helloHowAreYou: { text: 'Hola. ¿Cómo estás?' },
    regionVariant: 'es-ES',
  },
  fr: {
    hello: { text: 'Bonjour.' },
    howAreYou: { text: 'Comment ça va ?' },
    helloHowAreYou: { text: 'Bonjour. Comment ça va ?' },
  },
  de: {
    hello: { text: 'Hallo.' },
    howAreYou: { text: 'Wie geht es dir?' },
    helloHowAreYou: { text: 'Hallo. Wie geht es dir?' },
  },
  it: {
    hello: { text: 'Ciao.' },
    howAreYou: { text: 'Come stai?' },
    helloHowAreYou: { text: 'Ciao. Come stai?' },
  },
  // Tudo bem? is the everyday Brazilian how-are-you (vs the literal
  // textbook "Como você está?").
  pt: {
    hello: { text: 'Olá.' },
    howAreYou: { text: 'Tudo bem?' },
    helloHowAreYou: { text: 'Olá. Tudo bem?' },
  },
  pt_pt: {
    hello: { text: 'Olá.' },
    howAreYou: { text: 'Como estás?' },
    helloHowAreYou: { text: 'Olá. Como estás?' },
  },
  ro: {
    hello: { text: 'Bună.' },
    howAreYou: { text: 'Ce mai faci?' },
    helloHowAreYou: { text: 'Bună. Ce mai faci?' },
  },
  ca: {
    hello: { text: 'Hola.' },
    howAreYou: { text: 'Com estàs?' },
    helloHowAreYou: { text: 'Hola. Com estàs?' },
  },
  ru: {
    hello: { text: 'Привет.' },
    howAreYou: { text: 'Как дела?' },
    helloHowAreYou: { text: 'Привет. Как дела?' },
  },
  pl: {
    hello: { text: 'Cześć.' },
    howAreYou: { text: 'Jak się masz?' },
    helloHowAreYou: { text: 'Cześć. Jak się masz?' },
  },
  sk: {
    hello: { text: 'Ahoj.' },
    howAreYou: { text: 'Ako sa máš?' },
    helloHowAreYou: { text: 'Ahoj. Ako sa máš?' },
  },
  cs: {
    hello: { text: 'Ahoj.' },
    howAreYou: { text: 'Jak se máš?' },
    helloHowAreYou: { text: 'Ahoj. Jak se máš?' },
  },
  hr: {
    hello: { text: 'Bok.' },
    howAreYou: { text: 'Kako si?' },
    helloHowAreYou: { text: 'Bok. Kako si?' },
  },
  sl: {
    hello: { text: 'Živjo.' },
    howAreYou: { text: 'Kako si?' },
    helloHowAreYou: { text: 'Živjo. Kako si?' },
  },
  uk: {
    hello: { text: 'Привіт.' },
    howAreYou: { text: 'Як справи?' },
    helloHowAreYou: { text: 'Привіт. Як справи?' },
  },
  // Cyrillic exclusively, per the language's translationPromptNotes.
  sr: {
    hello: { text: 'Здраво.' },
    howAreYou: { text: 'Како си?' },
    helloHowAreYou: { text: 'Здраво. Како си?' },
  },
  bg: {
    hello: { text: 'Здравей.' },
    howAreYou: { text: 'Как си?' },
    helloHowAreYou: { text: 'Здравей. Как си?' },
  },
  lt: {
    hello: { text: 'Labas.' },
    howAreYou: { text: 'Kaip sekasi?' },
    helloHowAreYou: { text: 'Labas. Kaip sekasi?' },
  },
  lv: {
    hello: { text: 'Sveiki.' },
    howAreYou: { text: 'Kā tev iet?' },
    helloHowAreYou: { text: 'Sveiki. Kā tev iet?' },
  },
  et: {
    hello: { text: 'Tere.' },
    howAreYou: { text: 'Kuidas läheb?' },
    helloHowAreYou: { text: 'Tere. Kuidas läheb?' },
  },
  nl: {
    hello: { text: 'Hallo.' },
    howAreYou: { text: 'Hoe gaat het?' },
    helloHowAreYou: { text: 'Hallo. Hoe gaat het?' },
  },
  sv: {
    hello: { text: 'Hej.' },
    howAreYou: { text: 'Hur mår du?' },
    helloHowAreYou: { text: 'Hej. Hur mår du?' },
  },
  nb: {
    hello: { text: 'Hei.' },
    howAreYou: { text: 'Hvordan går det?' },
    helloHowAreYou: { text: 'Hei. Hvordan går det?' },
  },
  da: {
    hello: { text: 'Hej.' },
    howAreYou: { text: 'Hvordan går det?' },
    helloHowAreYou: { text: 'Hej. Hvordan går det?' },
  },
  // Hæ is the everyday face-to-face greeting (Halló skews phone-answering);
  // Hvað segirðu gott? is the idiomatic everyday how-are-you.
  is: {
    hello: { text: 'Hæ.' },
    howAreYou: { text: 'Hvað segirðu gott?' },
    helloHowAreYou: { text: 'Hæ. Hvað segirðu gott?' },
  },
  fi: {
    hello: { text: 'Hei.' },
    howAreYou: { text: 'Mitä kuuluu?' },
    helloHowAreYou: { text: 'Hei. Mitä kuuluu?' },
  },
  // Greek questions end in ';' (erotimatiko).
  el: {
    hello: { text: 'Γεια σου.' },
    howAreYou: { text: 'Τι κάνεις;' },
    helloHowAreYou: { text: 'Γεια σου. Τι κάνεις;' },
  },
  // Informal तुम form per the language's translationPromptNotes; masculine
  // addressee agreement (कैसे हो).
  hi: {
    hello: { text: 'नमस्ते।' },
    howAreYou: { text: 'तुम कैसे हो?' },
    helloHowAreYou: { text: 'नमस्ते। तुम कैसे हो?' },
  },
  // হ্যালো is the religiously neutral everyday greeting loanword; নমস্কার /
  // আসসালামু আলাইকুম are community-specific.
  bn: {
    hello: { text: 'হ্যালো।' },
    howAreYou: { text: 'তুমি কেমন আছো?' },
    helloHowAreYou: { text: 'হ্যালো। তুমি কেমন আছো?' },
  },
  // Pro-drop: the subject pronoun is naturally omitted (the -āy ending
  // already encodes informal 2nd-person singular).
  ta: {
    hello: { text: 'வணக்கம்.' },
    howAreYou: { text: 'எப்படி இருக்கிறாய்?' },
    helloHowAreYou: { text: 'வணக்கம். எப்படி இருக்கிறாய்?' },
  },
  te: {
    hello: { text: 'నమస్కారం.' },
    howAreYou: { text: 'నువ్వు ఎలా ఉన్నావు?' },
    helloHowAreYou: { text: 'నమస్కారం. నువ్వు ఎలా ఉన్నావు?' },
  },
  tr: {
    hello: { text: 'Merhaba.' },
    howAreYou: { text: 'Nasılsın?' },
    helloHowAreYou: { text: 'Merhaba. Nasılsın?' },
  },
  uz: {
    hello: { text: 'Salom.' },
    howAreYou: { text: 'Qalaysan?' },
    helloHowAreYou: { text: 'Salom. Qalaysan?' },
  },
  hu: {
    hello: { text: 'Szia.' },
    howAreYou: { text: 'Hogy vagy?' },
    helloHowAreYou: { text: 'Szia. Hogy vagy?' },
  },
  zh: {
    hello: { text: '你好。' },
    howAreYou: { text: '你好吗？' },
    helloHowAreYou: { text: '你好。你好吗？' },
  },
  zh_traditional: {
    hello: { text: '你好。' },
    howAreYou: { text: '你好嗎？' },
    helloHowAreYou: { text: '你好。你好嗎？' },
  },
  // Spoken-vernacular Cantonese per translationPromptNotes: 哈啰/哈囉 (haa1
  // lou3) is the everyday HK greeting, and 你點呀 (nei5 dim2 aa3) is the
  // vernacular how-are-you (你好嗎 is textbook/written register).
  // Romanization only on the traditional variant (simplified Cantonese has
  // needsRomanization: false).
  yue: {
    hello: { text: '哈啰。' },
    howAreYou: { text: '你点呀？' },
    helloHowAreYou: { text: '哈啰。你点呀？' },
  },
  yue_traditional: {
    hello: { text: '哈囉。' },
    howAreYou: { text: '你點呀？' },
    helloHowAreYou: { text: '哈囉。你點呀？' },
  },
  // Plain (informal) form per translationPromptNotes.
  ja: {
    hello: { text: 'こんにちは。' },
    howAreYou: { text: '元気？' },
    helloHowAreYou: { text: 'こんにちは。元気？' },
  },
  // 반말 per translationPromptNotes.
  ko: {
    hello: { text: '안녕.' },
    howAreYou: { text: '잘 지내?' },
    helloHowAreYou: { text: '안녕. 잘 지내?' },
  },
  // Chào bạn is the friendly everyday greeting (Xin chào is service-counter
  // stiff for an informal register).
  vi: {
    hello: { text: 'Chào bạn.' },
    howAreYou: { text: 'Bạn khỏe không?' },
    helloHowAreYou: { text: 'Chào bạn. Bạn khỏe không?' },
  },
  vi_south: {
    hello: { text: 'Chào bạn.' },
    howAreYou: { text: 'Bạn khỏe không?' },
    helloHowAreYou: { text: 'Chào bạn. Bạn khỏe không?' },
  },
  // Thai writes no sentence-final punctuation and separates sentences with a
  // space; informal register → no polite particle (ครับ/ค่ะ), per
  // translationPromptNotes.
  th: {
    hello: { text: 'สวัสดี' },
    howAreYou: { text: 'สบายดีไหม' },
    helloHowAreYou: { text: 'สวัสดี สบายดีไหม' },
  },
  id: {
    hello: { text: 'Halo.' },
    howAreYou: { text: 'Apa kabar?' },
    helloHowAreYou: { text: 'Halo. Apa kabar?' },
  },
  ms: {
    hello: { text: 'Helo.' },
    howAreYou: { text: 'Apa khabar?' },
    helloHowAreYou: { text: 'Helo. Apa khabar?' },
  },
  // "Hello." is a fully nativized Filipino greeting; using it keeps the pair
  // distinct from "Kumusta ka?" (which is itself the how-are-you).
  fil: {
    hello: { text: 'Hello.' },
    howAreYou: { text: 'Kumusta ka?' },
    helloHowAreYou: { text: 'Hello. Kumusta ka?' },
  },
  // Modern Standard Arabic; masculine addressee (حالُك) per convention. The
  // tanwīn on مرحبًا is written so the text matches the Marhaban reading.
  ar: {
    hello: { text: 'مرحبًا.' },
    howAreYou: { text: 'كيف حالك؟' },
    helloHowAreYou: { text: 'مرحبًا. كيف حالك؟' },
  },
  // هلا is the characteristic Saudi colloquial greeting ("MSA-leaning with
  // Hejazi/Najdi markers where natural" per translationPromptNotes).
  ar_sa: {
    hello: { text: 'هلا.' },
    howAreYou: { text: 'كيف حالك؟' },
    helloHowAreYou: { text: 'هلا. كيف حالك؟' },
  },
  // Colloquial Cairene per translationPromptNotes; tanwīn written on أهلاً
  // to match the Ahlan reading (same convention as MSA مرحبًا).
  ar_eg: {
    hello: { text: 'أهلاً.' },
    howAreYou: { text: 'إزيك؟' },
    helloHowAreYou: { text: 'أهلاً. إزيك؟' },
  },
  // Colloquial Iraqi per translationPromptNotes.
  ar_iq: {
    hello: { text: 'هلا.' },
    howAreYou: { text: 'شلونك؟' },
    helloHowAreYou: { text: 'هلا. شلونك؟' },
  },
  // Colloquial Levantine per translationPromptNotes.
  ar_lev: {
    hello: { text: 'مرحبا.' },
    howAreYou: { text: 'كيفك؟' },
    helloHowAreYou: { text: 'مرحبا. كيفك؟' },
  },
  // Masculine addressee (שלומְך→shlomkha) per convention.
  he: {
    hello: { text: 'שלום.' },
    howAreYou: { text: 'מה שלומך?' },
    helloHowAreYou: { text: 'שלום. מה שלומך?' },
  },
  // Colloquial spoken Persian (Tehrani) for the informal register; چطوری is
  // the most common standalone informal how-are-you.
  fa: {
    hello: { text: 'سلام.' },
    howAreYou: { text: 'چطوری؟' },
    helloHowAreYou: { text: 'سلام. چطوری؟' },
  },
  // Hujambo is inherently interrogative ("nothing ails you?") and is
  // conventionally written with a question mark.
  sw: {
    hello: { text: 'Hujambo?' },
    howAreYou: { text: 'Habari yako?' },
    helloHowAreYou: { text: 'Hujambo? Habari yako?' },
  },
  sw_tz: {
    hello: { text: 'Hujambo?' },
    howAreYou: { text: 'Habari yako?' },
    helloHowAreYou: { text: 'Hujambo? Habari yako?' },
  },
};
