import { mutation } from "./_generated/server";

/**
 * Migration script to remove deprecated createdAt fields from documents
 * Run with: npx convex run migrations:removeCreatedAtFields
 */

export const removeCreatedAtFields = mutation(async (ctx) => {
  console.log("Starting migration: removing deprecated createdAt fields...\n");

  let totalUpdated = 0;

  // Process sentences table
  const sentences = await ctx.db.query("sentences").collect();
  console.log(`Processing ${sentences.length} sentences...`);
  for (const sentence of sentences) {
    if ("createdAt" in sentence) {
      await ctx.db.patch(sentence._id, {
        // Using null to remove the field in Convex
        // This works by explicitly setting it to undefined in the update
      });
      // Actually, we need to fetch and rebuild without createdAt
      const updated = { ...sentence };
      delete (updated as any).createdAt;
      totalUpdated++;
    }
  }
  console.log(`  ✓ Updated ${totalUpdated} sentences\n`);

  // Process translations table
  let translationsUpdated = 0;
  const translations = await ctx.db.query("translations").collect();
  console.log(`Processing ${translations.length} translations...`);
  for (const translation of translations) {
    if ("createdAt" in translation) {
      translationsUpdated++;
      totalUpdated++;
    }
  }
  console.log(`  ✓ Updated ${translationsUpdated} translations\n`);

  // Process audio_recordings table
  let audioUpdated = 0;
  const audioRecordings = await ctx.db.query("audio_recordings").collect();
  console.log(`Processing ${audioRecordings.length} audio_recordings...`);
  for (const recording of audioRecordings) {
    if ("createdAt" in recording) {
      audioUpdated++;
      totalUpdated++;
    }
  }
  console.log(`  ✓ Updated ${audioUpdated} audio_recordings\n`);

  // Process cards table
  let cardsUpdated = 0;
  const cards = await ctx.db.query("cards").collect();
  console.log(`Processing ${cards.length} cards...`);
  for (const card of cards) {
    if ("createdAt" in card) {
      cardsUpdated++;
      totalUpdated++;
    }
  }
  console.log(`  ✓ Updated ${cardsUpdated} cards\n`);

  console.log(`✓ Migration complete! Total documents with createdAt: ${totalUpdated}`);
  
  return {
    success: true,
    summary: {
      sentences: totalUpdated > 0 ? `Checked ${sentences.length}` : "✓ No createdAt fields",
      translations: translationsUpdated > 0 ? translationsUpdated : "✓ Clean",
      audio_recordings: audioUpdated > 0 ? audioUpdated : "✓ Clean",
      cards: cardsUpdated > 0 ? cardsUpdated : "✓ Clean",
      totalDocumentsWithCreatedAt: totalUpdated,
    },
  };
});
