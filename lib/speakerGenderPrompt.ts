/**
 * The speaker-gender check: does an ENGLISH sentence fix the gender of the
 * person saying it? One prompt for the offline corpus scan
 * (scripts/classify-speaker-gender.mts) and the in-app check a "wrong
 * speaker" flag triggers (convex/features/sentenceMetadata.ts), so the two
 * cannot disagree on the rule. Dependency-free, like
 * lib/sentenceMetadataSource.ts, so a script can import it without the
 * Convex runtime.
 *
 * The rule is the speakerGender clause of the full classifier
 * (convex/lib/sentenceMetadataPrompt.ts) restricted to English: only the
 * sentence's own words about its speaker count. The answer is one word, so
 * a call costs one output token.
 */

export const SPEAKER_GENDER_VERDICTS = ['male', 'female', 'neutral'] as const;
export type SpeakerGenderVerdict = (typeof SPEAKER_GENDER_VERDICTS)[number];

/**
 * Written to `texts.metadataSource` by the corpus scan (through the
 * `applySpeakerGenderVerdicts` migration and the dataset upload) and by the
 * in-app check. Bump the suffix when the prompt or the model changes in a
 * way that should re-derive existing verdicts.
 */
export const SPEAKER_GENDER_SCAN_SOURCE = 'speaker-scan-v1';
export const SPEAKER_GENDER_CHECK_SOURCE = 'speaker-check-v1';

const SYSTEM_PROMPT = `You decide whether an English sentence fixes the gender of the person SAYING it. Answer with exactly one word: male, female, or neutral. No punctuation, no explanation.

Answer "male" or "female" ONLY when the sentence's own words describe the speaker with a gendered word:
- A gendered noun said of the speaker, including a family or role word that names the speaker in relation to someone else: "I am her husband" = male, "I am his wife" = female, "I'm their daughter" = female, "As a father, I worry" = male, "I'm the bride" = female, "I was a shy girl" = female.
- A gendered noun said of a first-person PLURAL subject that includes the speaker: "We are brothers" = male, "We are sisters" = female, "We're both mothers" = female. "We" plus a mixed or unisex noun ("We are friends", "We are siblings", "We are parents") fixes nothing.
- A state only one gender can be in, said of the speaker: "I'm pregnant" = female.

Answer "neutral" in every other case, including:
- The gender of anyone else. A relative, spouse, partner, friend or colleague ("My wife is a doctor", "Her brother called", "My husband and I went out") says nothing about the speaker's own gender.
- Quoted speech: a gendered word inside a quotation belongs to the quoted person, unless the speaker quotes themselves.
- Names, jobs, topics and stereotypes ("I'm a nurse", "I love football", "I was knitting") fix nothing.
- Sentences with no first person at all.

Be strict: when in doubt, answer neutral.`;

/** The system prompt. Static, the same string for every request. */
export function buildSpeakerGenderSystemPrompt(): string {
  return SYSTEM_PROMPT;
}

export function buildSpeakerGenderUserPrompt(sentence: string): string {
  return `Sentence: ${sentence.trim()}\nAnswer:`;
}

/**
 * The model's one word, or null when it answered anything else (the scan
 * retries those; the in-app check treats them as no verdict).
 */
export function parseSpeakerGenderVerdict(
  raw: string,
): SpeakerGenderVerdict | null {
  const word = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  return (SPEAKER_GENDER_VERDICTS as readonly string[]).includes(word)
    ? (word as SpeakerGenderVerdict)
    : null;
}

/**
 * The `texts` fields a scan or check verdict sets: the verdict itself, its
 * source tag, and (for a definitive one) the voice. Empty for anything that
 * is not a verdict, so an upload row without one clears nothing.
 */
export function speakerGenderPatch(
  verdict: string | null | undefined,
  source: string,
): {
  speakerGender?: SpeakerGenderVerdict;
  audioSpeakerGender?: 'male' | 'female';
  metadataSource?: string;
} {
  if (verdict !== 'male' && verdict !== 'female' && verdict !== 'neutral') {
    return {};
  }
  return {
    speakerGender: verdict,
    metadataSource: source,
    ...(verdict === 'neutral' ? {} : { audioSpeakerGender: verdict }),
  };
}
