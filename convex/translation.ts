"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";

const axios = require("axios").default;

export const translateText = action({
  args: {
    text: v.string(),
    sourceLang: v.string(), // e.g., "zh"
    targetLang: v.string(), // e.g., "en"
  },
  returns: v.object({
    translatedText: v.string(),
  }),
  handler: async (_ctx, args) => {
    const apiKey = process.env.EDENAI_API_KEY;
    if (!apiKey) {
      throw new Error("EDENAI_API_KEY not set in Convex env");
    }
    const options = {
      method: "POST",
      url: "https://api.edenai.run/v2/translation/automatic_translation",
      headers: {
        authorization: `Bearer ${apiKey}`//${process.env.EDENAI_API_KEY}`,
      },
      data: {
        providers: "google",
        text: args.text,
        source_language: args.sourceLang,
        target_language: args.targetLang,
      },
    };
    

    try {
      const response = await axios.request(options);

      const translatedText = response.data?.google?.text;
      if (!translatedText) throw new Error("No translation returned from Eden AI");

      return { translatedText };
    } catch (err: any) {
      console.error("Translation error:", err.response?.data || err.message);
      throw new Error(`Translation failed: ${err.message}`);
    }
  },
});
