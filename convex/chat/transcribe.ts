"use node";

import { action } from "../_generated/server";
import { v, ConvexError } from "convex/values";
import { experimental_transcribe as transcribe } from "ai";
import { openai } from "@ai-sdk/openai";
import { authComponent } from "../auth";

/**
 * Transcribe audio using OpenAI Transcription API
 */
export const transcribeAudio = action({
  args: {
    audio: v.bytes(),
  },
  returns: v.string(),
  handler: async (ctx, args) => {

    const user = await authComponent.getAuthUser(ctx);
    if (!user) {
      throw new ConvexError("User not authenticated");
    }

    try {
      const transcript = await transcribe({
        model: openai.transcription("gpt-4o-mini-transcribe"),
        audio: args.audio,
      });

      return transcript.text;
    } catch (error) {
      console.error("Transcription error:", error);
      throw new ConvexError(
        error instanceof Error ? error.message : "Failed to transcribe audio"
      );
    }
  },
});


