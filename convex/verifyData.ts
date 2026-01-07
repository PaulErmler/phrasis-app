import { query } from "./_generated/server";

/**
 * Verify audio_recordings have all required fields
 */
export const verifyAudioRecordings = query(async (ctx) => {
  const audioRecordings = await ctx.db.query("audio_recordings").collect();
  
  const summary = {
    total: audioRecordings.length,
    withStorageId: audioRecordings.filter(r => r.storageId).length,
    withoutStorageId: audioRecordings.filter(r => !r.storageId).length,
    samples: audioRecordings.slice(0, 3).map(r => ({
      _id: r._id,
      sentenceId: r.sentenceId,
      language: r.language,
      voice: r.voice,
      storageId: r.storageId ? "✓ present" : "✗ MISSING",
    })),
  };
  
  return summary;
});

/**
 * Verify sentences have required fields
 */
export const verifySentences = query(async (ctx) => {
  const sentences = await ctx.db.query("sentences").collect();
  
  const summary = {
    total: sentences.length,
    samples: sentences.slice(0, 3).map(s => ({
      _id: s._id,
      text: s.text,
      language: s.language,
    })),
  };
  
  return summary;
});

/**
 * Verify translations have required fields
 */
export const verifyTranslations = query(async (ctx) => {
  const translations = await ctx.db.query("translations").collect();
  
  const summary = {
    total: translations.length,
    samples: translations.slice(0, 3).map(t => ({
      _id: t._id,
      sentenceId: t.sentenceId,
      targetLanguage: t.targetLanguage,
      translatedText: t.translatedText,
    })),
  };
  
  return summary;
});
