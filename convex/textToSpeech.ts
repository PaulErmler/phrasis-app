"use node";

import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import axios from "axios";

// Translate text using Eden AI
export const translateText = action({
  args: {
    text: v.string(),
    sourceLang: v.string(),
    targetLang: v.string(),
  },
  returns: v.string(),
  handler: async (_ctx, args) => {
    const apiKey = process.env.EDENAI_API_KEY;
    if (!apiKey) throw new ConvexError("EDENAI_API_KEY not set");

    const response = await fetch("https://api.edenai.run/v2/translation/automatic_translation", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        providers: "google",
        text: args.text,
        source_language: args.sourceLang,
        target_language: args.targetLang,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new ConvexError(`Eden AI Translation API error: ${errorText}`);
    }

    const data = await response.json();
    return data.google?.text ?? "";
  },
});

// Generate TTS audio using Eden AI
export const generateSpeech = action({
  args: {
    text: v.string(),
    language: v.string(),
  },
  returns: v.string(),
  handler: async (_ctx, args) => {
    const apiKey = process.env.EDENAI_API_KEY;
    if (!apiKey) throw new ConvexError("EDENAI_API_KEY not set");

    try {
      const response = await axios.post(
        "https://api.edenai.run/v2/audio/text_to_speech",
        {
          providers: "google",
          text: args.text,
          language: args.language,
          option: "FEMALE",
          model: "chirp-3",
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
        }
      );

      const audioData = response.data?.google?.audio;
      if (!audioData) throw new ConvexError("No audio returned from Eden AI");

      return `data:audio/mp3;base64,${audioData}`;
    } catch (err: any) {
      console.error("TTS error:", err.response?.data || err.message);
      throw new ConvexError(`Failed to generate audio: ${err.message}`);
    }
  },
});