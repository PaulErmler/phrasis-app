import { answersMatchExactly } from '@/lib/textCompare';

/**
 * After submit, the header speaker plays the sentence currently on screen —
 * the closest accepted phrasing — never a different accepted answer listed
 * below. Three-way rule:
 *
 * 1. The card's own sentence → its clip.
 * 2. A stored accepted alternative → its clip, or nothing while its audio is
 *    still generating. Never the primary here: that would say a different
 *    sentence than the one displayed.
 * 3. Anything else (an unstored grader correction — verdict minor/partial/
 *    wrong) → the primary clip. No clip is ever coming for that sentence,
 *    and the answer wasn't an accepted phrasing, so the card's default is
 *    what to play. Callers must gate the alsoCorrect window themselves
 *    (grade accepted but the alternative row hasn't landed yet), since only
 *    they can see the verdict.
 *
 * Matching is the same punctuation/case-insensitive equality the writing
 * gate uses, so a shown "okay ," still finds the stored "okay," clip.
 */
export function audioUrlForShownSentence(
  shownText: string,
  primaryText: string,
  primaryAudioUrl: string | null,
  accepted: readonly { text: string; audioUrl?: string | null }[],
): string | null {
  if (answersMatchExactly(shownText, primaryText)) return primaryAudioUrl;
  const match = accepted.find((item) =>
    answersMatchExactly(item.text, shownText),
  );
  if (!match) return primaryAudioUrl;
  return match.audioUrl ?? null;
}

/**
 * Tiny silent WAV. `play()` during Enter/submit keeps the element unlocked
 * so a later `src` swap (grader + TTS) is still allowed. A new `Audio()`
 * created after that wait is blocked, which is why alternative autoplay
 * was silent.
 */
export const AFTER_SUBMIT_UNLOCK_SRC =
  'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';

export function primeAfterSubmitAudioElement(
  existing: HTMLAudioElement | null,
): HTMLAudioElement {
  if (existing) return existing;
  const audio = new Audio(AFTER_SUBMIT_UNLOCK_SRC);
  audio.muted = true;
  // Hold the gesture unlock until the real clip lands. A one-shot silent
  // WAV ends in milliseconds; after that a later play() is blocked again.
  audio.loop = true;
  audio.preservesPitch = true;
  const webkitAudio = audio as HTMLAudioElement & {
    webkitPreservesPitch?: boolean;
  };
  webkitAudio.webkitPreservesPitch = true;
  void audio.play().catch(() => {
    // No gesture / policy: the later play() may still fail.
  });
  return audio;
}

