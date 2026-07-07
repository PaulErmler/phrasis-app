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
  MAX_OUTPUT_TOKENS,
  translateTextWithLLM,
} from "../../features/translationLLM";
import { resolveTranslationStages } from "../../../lib/languages";

describe("features/translationLLM", () => {
  describe("translation rules", () => {
    it("default_hybrid: Gemini 3.5 Flash Nitro (minimal) primary AND fallback", () => {
      // 'nl' has no `translationRule` set → defaults to `default_hybrid`.
      // Length-hybrid branching was retired — every source length runs
      // the same chain. Fallback is the same config as primary; it only
      // exists to retry once on transient HTTP errors before Google.
      const stages = resolveTranslationStages("nl", 12);
      expect(stages.length).toBe(2);
      const nitroMinimal = {
        model: "google/gemini-3.5-flash:nitro",
        reasoning: "minimal",
        maxOutputTokens: 4_000,
      };
      expect(stages[0]).toEqual(nitroMinimal);
      expect(stages[1]).toEqual(nitroMinimal);
    });

    it("default_hybrid is length-agnostic — same chain for short and long inputs", () => {
      // Lengths are arbitrary — length-hybrid branching was retired, so any
      // short vs long pair must resolve to the same chain.
      const short = resolveTranslationStages("nl", 5);
      const long = resolveTranslationStages("nl", 200);
      expect(short).toEqual(long);
    });

    it("de uses gemini_35_flash_nitro_minimal (minimal thinking, primary + fallback)", () => {
      const stages = resolveTranslationStages("de", 12);
      expect(stages.length).toBe(2);
      const nitroMinimal = {
        model: "google/gemini-3.5-flash:nitro",
        reasoning: "minimal",
        maxOutputTokens: 4_000,
      };
      expect(stages[0]).toEqual(nitroMinimal);
      expect(stages[1]).toEqual(nitroMinimal);
    });

    it("fr uses gemini_35_flash_nitro_minimal (minimal thinking, primary + fallback)", () => {
      const stages = resolveTranslationStages("fr", 12);
      expect(stages.length).toBe(2);
      const nitroMinimal = {
        model: "google/gemini-3.5-flash:nitro",
        reasoning: "minimal",
        maxOutputTokens: 4_000,
      };
      expect(stages[0]).toEqual(nitroMinimal);
      expect(stages[1]).toEqual(nitroMinimal);
    });

    it("retranslation_high: forced via ruleOverride uses Gemini 3.1 Pro (medium) as a second opinion", () => {
      const stages = resolveTranslationStages("de", 100, {
        ruleOverride: "retranslation_high",
      });
      // Different (heavier) model than the default Flash tier so flagged
      // curriculum rows get an actual cross-model second opinion rather
      // than re-sampling Flash.
      expect(stages.length).toBe(1);
      expect(stages[0]).toEqual({
        model: "google/gemini-3.1-pro-preview",
        reasoning: "medium",
        maxOutputTokens: 8_000,
      });
    });

    it("retranslation_custom: forced via ruleOverride uses Gemini 3.1 Flash Lite (minimal)", () => {
      const stages = resolveTranslationStages("de", 100, {
        ruleOverride: "retranslation_custom",
      });
      // Custom-text retranslations stay on the cheaper Flash Lite tier
      // with a `minimal` thinking pass so the retranslation has a real
      // shot at catching what the user flagged.
      expect(stages.length).toBe(1);
      expect(stages[0]).toEqual({
        model: "google/gemini-3.1-flash-lite",
        reasoning: "minimal",
        maxOutputTokens: 4_000,
      });
    });

    it("zh is pinned to gemini_35_flash_nitro_minimal (with a translationVersion bump)", () => {
      const stages = resolveTranslationStages("zh", 12);
      expect(stages.length).toBe(2);
      expect(stages[0].model).toBe("google/gemini-3.5-flash:nitro");
      expect(stages[0].reasoning).toBe("minimal");
      expect(stages[1].model).toBe("google/gemini-3.5-flash:nitro");
      expect(stages[1].reasoning).toBe("minimal");
    });

    it("unknown language code falls through to default_hybrid", () => {
      const stages = resolveTranslationStages("zz", 100);
      expect(stages.length).toBe(2);
      expect(stages[0].model).toBe("google/gemini-3.5-flash:nitro");
      expect(stages[0].reasoning).toBe("minimal");
      expect(stages[1].model).toBe("google/gemini-3.5-flash:nitro");
      expect(stages[1].reasoning).toBe("minimal");
    });
  });

  describe("buildPrompt", () => {
    const baseArgs = {
      text: "Have you looked in the glove compartment?",
      sourceLang: "en",
      targetLang: "de",
      targetLangName: "German",
      targetLangNativeName: "Deutsch",
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

    it("emits 'English (native) (parens)' when native name differs from English name", () => {
      const p = buildPrompt({ ...baseArgs, addressesSomeone: false });
      // baseArgs has targetLangName='German', targetLangNativeName='Deutsch'.
      expect(p).toContain("German (Deutsch)");
      // Should appear in the opening role line and the closing instruction.
      expect(p).toMatch(/English-to-German \(Deutsch\) translator/);
      expect(p).toMatch(/Output only the German \(Deutsch\) translation/);
    });

    it("does NOT emit redundant parens when native name matches the English name", () => {
      // English variants share the script — `en_us` has name=English,
      // nativeName=English. The prompt should say "English", not "English (English)".
      const p = buildPrompt({
        ...baseArgs,
        targetLang: "en_us",
        targetLangName: "English",
        targetLangNativeName: "English",
        addressesSomeone: false,
      });
      expect(p).not.toContain("English (English)");
      expect(p).toMatch(/English-to-English translator/);
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
      targetLangNativeName: "Deutsch",
      targetRegion: "Germany",
      addressesSomeone: true,
      referentGender: "female" as const,
      model: "google/gemini-3.1-flash-lite",
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

    it("omits providerOptions.openrouter.reasoning when caller doesn't pass reasoning", async () => {
      // translateTextWithLLM no longer applies a length-hybrid default —
      // the translation rule decides reasoning upstream. When the caller
      // passes no `reasoning`, no providerOptions are sent.
      mockOpenRouterOk("Hallo.");
      await translateTextWithLLM(callArgs);
      const callArg = vi.mocked(generateText).mock.calls[0][0];
      expect(callArg.providerOptions).toBeUndefined();
    });

    it("sends reasoning effort verbatim when caller passes it", async () => {
      mockOpenRouterOk("...");
      await translateTextWithLLM({
        ...callArgs,
        text: "a".repeat(35),
        reasoning: "low",
      });
      const callArg = vi.mocked(generateText).mock.calls[0][0];
      expect(callArg.providerOptions).toEqual({
        openrouter: { reasoning: { effort: "low" } },
      });
    });

    it("sends reasoning effort='high' for explicit overrides too", async () => {
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

    it("sends reasoning effort='minimal' verbatim despite SDK type only covering low/medium/high", async () => {
      // OpenRouter accepts `'minimal'` at runtime (maps to Gemini's
      // `thinkingLevel: 'minimal'`); the @openrouter/ai-sdk-provider@1.5.4
      // types haven't caught up, so `translateTextWithLLM` casts at the
      // SDK boundary. Verify the string survives intact.
      mockOpenRouterOk("Hallo.");
      await translateTextWithLLM({
        ...callArgs,
        text: "Hi.",
        reasoning: "minimal",
      });
      const callArg = vi.mocked(generateText).mock.calls[0][0];
      expect(callArg.providerOptions).toEqual({
        openrouter: { reasoning: { effort: "minimal" } },
      });
    });
  });
});
