import { query } from "./_generated/server";

/**
 * Backup script to export data from tables with deprecated createdAt field
 * Run with: npx convex run backupData.backupTables
 * Copy the output to a file for safekeeping
 */

export const backupTables = query(async (ctx) => {
  console.log("Starting data backup...");

  // Backup sentences
  const sentences = await ctx.db.query("sentences").collect();
  console.log(`Backed up ${sentences.length} sentences`);

  // Backup translations
  const translations = await ctx.db.query("translations").collect();
  console.log(`Backed up ${translations.length} translations`);

  // Backup audio_recordings
  const audioRecordings = await ctx.db.query("audio_recordings").collect();
  console.log(`Backed up ${audioRecordings.length} audio_recordings`);

  // Backup cards
  const cards = await ctx.db.query("cards").collect();
  console.log(`Backed up ${cards.length} cards`);

  const backup = {
    timestamp: new Date().toISOString(),
    tables: {
      sentences: {
        count: sentences.length,
        data: sentences,
      },
      translations: {
        count: translations.length,
        data: translations,
      },
      audio_recordings: {
        count: audioRecordings.length,
        data: audioRecordings,
      },
      cards: {
        count: cards.length,
        data: cards,
      },
    },
  };

  console.log("Backup complete. Total records:", 
    sentences.length + translations.length + audioRecordings.length + cards.length);

  return backup;
});
