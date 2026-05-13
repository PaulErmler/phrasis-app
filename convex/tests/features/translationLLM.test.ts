/// <reference types="vite/client" />
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("ai", () => ({
  generateText: vi.fn(),
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  // The provider factory is called as `createOpenRouter({...})` and then
  // invoked as `openrouter(modelSlug)` to get a model handle. Tests only care
  // that this returns something `generateText` can be called with — the mock
  // for `generateText` ignores it.
  createOpenRouter: () => (modelSlug: string) => ({ modelId: modelSlug }),
}));

import { generateText } from "ai";
import {
  buildPrompt,
  pickReasoning,
  HYBRID_LENGTH_THRESHOLD,
  MAX_OUTPUT_TOKENS,
  translateTextWithLLM,
} from "../../features/translationLLM";

describe("features/translationLLM", () => {
  describe("pickReasoning (hybrid length rule)", () => {
    it("returns undefined (minimal) for sentences shorter than the threshold", () => {
      expect(pickReasoning("Hi.")).toBeUndefined();
      expect(pickReasoning("a".repeat(HYBRID_LENGTH_THRESHOLD - 1))).toBeUndefined();
    });

    it("returns 'low' for sentences at or above the threshold", () => {
      expect(pickReasoning("a".repeat(HYBRID_LENGTH_THRESHOLD))).toBe("low");
      expect(pickReasoning("a".repeat(HYBRID_LENGTH_THRESHOLD + 50))).toBe("low");
    });

    it("respects an explicit override regardless of length", () => {
      // Short text + medium override → medium.
      expect(pickReasoning("Hi.", "medium")).toBe("medium");
      // Long text + medium override → medium (not 'low').
      expect(pickReasoning("a".repeat(200), "medium")).toBe("medium");
      // Short text + high override → high.
      expect(pickReasoning("Hi.", "high")).toBe("high");
    });
  });

  describe("buildPrompt", () => {
    const baseArgs = {
      text: "Have you looked in the glove compartment?",
      sourceLang: "en",
      targetLang: "de",
      targetLangName: "German",
      targetRegion: "Germany",
      referentGender: "male" as const,
    };

    it("includes the source inside <source> tags", () => {
      const p = buildPrompt({ ...baseArgs, addressesSomeone: false });
      expect(p).toContain(
        "<source>Have you looked in the glove compartment?</source>",
      );
    });

    it("always emits <speaker_gender> and <referent_gender>", () => {
      const p = buildPrompt({ ...baseArgs, addressesSomeone: false });
      expect(p).toMatch(/<speaker_gender>.+<\/speaker_gender>/);
      expect(p).toContain("<referent_gender>male</referent_gender>");
    });

    it("OMITS <addressee_gender> and <register> when addressesSomeone=false", () => {
      const p = buildPrompt({
        ...baseArgs,
        addressesSomeone: false,
        addresseeGender: "female",
        formality: "formal",
      });
      expect(p).not.toContain("<addressee_gender>");
      expect(p).not.toContain("<register>");
    });

    it("EMITS <addressee_gender> and <register> when addressesSomeone=true", () => {
      const p = buildPrompt({
        ...baseArgs,
        addressesSomeone: true,
        addresseeGender: "female",
        formality: "informal",
      });
      expect(p).toContain("<addressee_gender>female</addressee_gender>");
      expect(p).toContain("<register>informal</register>");
    });

    it("emits <register>neutral</register> when addressesSomeone=true and formality is missing", () => {
      const p = buildPrompt({
        ...baseArgs,
        addressesSomeone: true,
      });
      expect(p).toContain("<register>neutral</register>");
    });

    it("includes the 'neutral is informal' instruction so German doesn't default to Sie", () => {
      const p = buildPrompt({ ...baseArgs, addressesSomeone: true });
      expect(p).toMatch(
        /'informal' and 'neutral' both mean the casual T-form/i,
      );
    });

    it("mentions the referent_gender role for gendered occupation nouns", () => {
      const p = buildPrompt({ ...baseArgs, addressesSomeone: false });
      expect(p).toMatch(/referent_gender drives third-party noun forms/);
    });
  });

  describe("translateTextWithLLM", () => {
    const originalKey = process.env.OPENROUTER_API_KEY;

    beforeEach(() => {
      vi.mocked(generateText).mockReset();
      process.env.OPENROUTER_API_KEY = "test-key";
    });
    afterEach(() => {
      if (originalKey === undefined) {
        delete process.env.OPENROUTER_API_KEY;
      } else {
        process.env.OPENROUTER_API_KEY = originalKey;
      }
    });

    const callArgs = {
      text: "Hi.",
      sourceLang: "en",
      targetLang: "de",
      targetLangName: "German",
      targetRegion: "Germany",
      addressesSomeone: true,
      referentGender: "female" as const,
      model: "google/gemini-3.1-flash-lite-preview",
    };

    function mockOpenRouterOk(content: string, finishReason: string = "stop") {
      vi.mocked(generateText).mockResolvedValueOnce({
        text: content,
        finishReason,
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      } as any);
    }

    it("returns ok:true with the translated text on a normal success", async () => {
      mockOpenRouterOk("Hallo.");
      const result = await translateTextWithLLM(callArgs);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.text).toBe("Hallo.");
        expect(result.inputTokens).toBe(100);
        expect(result.outputTokens).toBe(20);
      }
    });

    it("strips wrapping straight quotes", async () => {
      mockOpenRouterOk('"Hallo."');
      const result = await translateTextWithLLM(callArgs);
      expect(result.ok && result.text).toBe("Hallo.");
    });

    it("preserves unmatched typographic quote pairs (strip only fires when first === last)", async () => {
      mockOpenRouterOk("„Hallo.“");
      const result = await translateTextWithLLM(callArgs);
      // „…" uses different open/close glyphs, so stripWrappingQuotes — which
      // only fires when first === last — leaves the content alone.
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.text).toBe("„Hallo.“");
    });

    it("returns ok:false with reason='truncated' on finishReason=length", async () => {
      mockOpenRouterOk("incomplete...", "length");
      const result = await translateTextWithLLM(callArgs);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("truncated");
      }
    });

    it("returns ok:false with reason='empty' when the visible content is blank", async () => {
      mockOpenRouterOk("");
      const result = await translateTextWithLLM(callArgs);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("empty");
      }
    });

    it("returns ok:false with reason='http_error' when the SDK throws an API error", async () => {
      vi.mocked(generateText).mockRejectedValueOnce(
        new Error("status=429 rate limited"),
      );
      const result = await translateTextWithLLM(callArgs);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("http_error");
        expect(result.detail).toMatch(/429/);
      }
    });

    it("returns ok:false with reason='http_error' when the SDK throws on network failure", async () => {
      vi.mocked(generateText).mockRejectedValueOnce(new Error("network down"));
      const result = await translateTextWithLLM(callArgs);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("http_error");
        expect(result.detail).toMatch(/network down/);
      }
    });

    it("sends maxOutputTokens at the configured cap and temperature=0", async () => {
      mockOpenRouterOk("Hallo.");
      await translateTextWithLLM(callArgs);
      const callArg = vi.mocked(generateText).mock.calls[0][0];
      expect(callArg.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
      expect(callArg.temperature).toBe(0);
    });

    it("omits providerOptions.openrouter.reasoning for short sentences (hybrid rule)", async () => {
      mockOpenRouterOk("Hallo.");
      await translateTextWithLLM(callArgs); // text='Hi.' → len < 30 → no reasoning
      const callArg = vi.mocked(generateText).mock.calls[0][0];
      expect(callArg.providerOptions).toBeUndefined();
    });

    it("sends reasoning effort=low for sentences at/above the threshold", async () => {
      mockOpenRouterOk("...");
      await translateTextWithLLM({
        ...callArgs,
        text: "a".repeat(HYBRID_LENGTH_THRESHOLD + 5),
      });
      const callArg = vi.mocked(generateText).mock.calls[0][0];
      expect(callArg.providerOptions).toEqual({
        openrouter: { reasoning: { effort: "low" } },
      });
    });

    it("uses the explicit reasoning override regardless of length", async () => {
      mockOpenRouterOk("Hallo.");
      await translateTextWithLLM({
        ...callArgs,
        text: "Hi.",
        reasoning: "high",
      });
      const callArg = vi.mocked(generateText).mock.calls[0][0];
      expect(callArg.providerOptions).toEqual({
        openrouter: { reasoning: { effort: "high" } },
      });
    });
  });
});
