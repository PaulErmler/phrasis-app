/**
 * Strip the markdown code fences LLMs wrap JSON replies in (```json ... ```),
 * leaving the payload for the caller's own JSON.parse + validation. The one
 * answer to "what does the model wrap its JSON in" — previously copied
 * byte-identically into four parsers (customTexts, sentenceMetadata,
 * ttsSemanticValidation, writingFeedback), which is exactly how a new fence
 * variant would get handled in one of them and missed in the others.
 */
export function stripJsonFences(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/, '')
    .trim();
}
