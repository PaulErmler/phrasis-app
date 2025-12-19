"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import axios from "axios";

export const translateText = action({
  args: {
    text: v.string(),
    sourceLang: v.string(), // e.g., "en"
    targetLang: v.string(), // e.g., "es"
  },
  returns: v.object({
    translatedText: v.string(),
  }),
  handler: async (_ctx, args) => {
    const apiKey = process.env.EDENAI_API_KEY;
    if (!apiKey) {
      throw new Error("EDENAI_API_KEY environment variable is not set");
    }

    try {
      const response = await axios.post(
        "https://api.edenai.run/v2/translation/automatic_translation",
        {
          providers: "google",
          text: args.text,
          source_language: args.sourceLang,
          target_language: args.targetLang,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const translatedText = response.data?.google?.text;
      if (!translatedText) throw new Error("No translation returned from Eden AI");

      return { translatedText };
    } catch (err: any) {
      console.error("Translation error:", err.response?.data || err.message);
      throw new Error(`Translation failed: ${err.message}`);
    }
  },
});
