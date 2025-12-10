import { Agent } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { stepCountIs } from "ai";
import { gateway } from "ai";


export const agent = new Agent(components.agent, {
  name: "Chat Assistant",
  languageModel: gateway("gemini-2.5-flash-lite"),
  instructions: "You are a helpful AI assistant. Be concise, accurate, and friendly in your responses.",
  stopWhen: stepCountIs(10), // Limit tool call steps
});

