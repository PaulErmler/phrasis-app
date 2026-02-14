/**
 * Shared translation helper — used by features/decks.ts and testing/translation.ts.
 * No Convex function exports; just a plain async helper.
 */

/** Google Translation API response type */
interface GoogleTranslateResponse {
  data: {
    translations: Array<{
      translatedText: string;
    }>;
  };
}

/**
 * Call the Google Cloud Translation REST API.
 * Returns the translated text. Throws on any error.
 */
export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<string> {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  if (!apiKey) throw new Error('Translation service not configured');

  const response = await fetch(
    `https://translation.googleapis.com/language/translate/v2?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        q: text,
        source: sourceLang,
        target: targetLang,
        format: 'text',
      }),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Google API error: ${response.status} - ${errorText}`);
  }

  const data = (await response.json()) as GoogleTranslateResponse;
  const translation = data.data?.translations?.[0]?.translatedText;
  if (!translation) throw new Error('No translation returned from Google API');

  return translation;
}
