"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
const axios = require("axios").default;


// Translate text using Eden AI
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
    const options = {
      method: "POST",
      url: "https://api.edenai.run/v2/translation/automatic_translation",
      headers: {
        authorization: `Bearer ${process.env.EDENAI_API_KEY}`,
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


// Generate TTS audio using Eden AI (axios.request style)
export const generateSpeech = action({
  args: {
    text: v.string(),
    language: v.string(),
  },
  returns: v.string(),
  handler: async (_ctx, args) => {
    console.log("EDENAI_API_KEY:", process.env.EDENAI_API_KEY);
    const apiKey = process.env.EDENAI_API_KEY;
    //const apiKey ="jafkjahglj"
    //if (!apiKey) throw new Error("EDENAI_API_KEY not set");

    const options = {
      method: "POST",
      url: "https://api.edenai.run/v2/audio/text_to_speech",
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      data: {
        providers: "google",
        text: args.text,
        language: args.language,
        option: "FEMALE",
      },
    };

    try {
      const response = await axios.request(options);
      const audioData = response.data?.google?.audio;
      if (!audioData) throw new Error("No audio returned from Eden AI");
      return `data:audio/mp3;base64,${audioData}`;
    } catch (err: any) {
      console.error("TTS error:", err.response?.data || err.message);
      throw new Error(`Failed to generate audio: ${err.message}`);
    }
  },
});
