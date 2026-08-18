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
  buildJudgePrompt,
  buildPrompt,
  MAX_OUTPUT_TOKENS,
  translateBestOfN,
  translateTextWithLLM,
} from "../../features/translationLLM";
import {
  GEMINI_35_FLASH_NITRO_MINIMAL,
  LUNA_BO3,
  resolveTranslationStages,
} from "../../../lib/languages";

describe("features/translationLLM", () => {
  describe("translation rules", () => {
    it("default rule: Luna best-of-3 primary, Gemini 3.7 Flash Nitro fallback", () => {
      // No language sets `translationRule` → all default to `luna_bo3`
      // (Aug 2026 eval winner). The Gemini stage stays as the fallback so a
      // Luna outage degrades to the previous production config before the
      // Google safety net.
      const stages = resolveTranslationStages("nl", 12);
      expect(stages.length).toBe(2);
      expect(stages[0]).toEqual(LUNA_BO3);
      expect(stages[1]).toEqual(GEMINI_35_FLASH_NITRO_MINIMAL);
    });

    it("LUNA_BO3 stage shape: no-thinking Luna, price cap, 1+2 sampling, no-thinking judge", () => {
      expect(LUNA_BO3).toEqual({
        model: "openai/gpt-5.6-luna:nitro",
        reasoning: "none",
        maxOutputTokens: 4_000,
        provider: {
          max_price: { completion: 2 },
          order: ["amazon-bedrock/us-east-1"],
        },
        samples: { total: 3, extraTemperature: 1 },
        judge: {
          model: "openai/gpt-5.6-luna:nitro",
          reasoning: "none",
          provider: {
            max_price: { completion: 2 },
            order: ["amazon-bedrock/us-east-1"],
          },
          maxRetries: 2,
        },
      });
    });

    it("default rule is length-agnostic — same chain for short and long inputs", () => {
      // Lengths are arbitrary — length-hybrid branching was retired, so any
      // short vs long pair must resolve to the same chain.
      const short = resolveTranslationStages("nl", 5);
      const long = resolveTranslationStages("nl", 200);
      expect(short).toEqual(long);
    });

    it("de and fr use the luna_bo3 default", () => {
      for (const code of ["de", "fr"]) {
        const stages = resolveTranslationStages(code, 12);
        expect(stages.length).toBe(2);
        expect(stages[0]).toEqual(LUNA_BO3);
        expect(stages[1]).toEqual(GEMINI_35_FLASH_NITRO_MINIMAL);
      }
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

    it("retranslation_custom: forced via ruleOverride uses Gemini 3.5 Flash Lite (minimal)", () => {
      const stages = resolveTranslationStages("de", 100, {
        ruleOverride: "retranslation_custom",
      });
      // Custom-text retranslations stay on the Flash Lite tier with a
      // `minimal` thinking pass so the retranslation has a real shot at
      // catching what the user flagged.
      expect(stages.length).toBe(1);
      expect(stages[0]).toEqual({
        model: "google/gemini-3.5-flash-lite",
        reasoning: "minimal",
        maxOutputTokens: 4_000,
      });
    });

    it("zh uses the luna_bo3 default (with a translationVersion bump)", () => {
      const stages = resolveTranslationStages("zh", 12);
      expect(stages.length).toBe(2);
      expect(stages[0].model).toBe("openai/gpt-5.6-luna:nitro");
      expect(stages[0].samples).toEqual({ total: 3, extraTemperature: 1 });
      expect(stages[1].model).toBe("google/gemini-3.7-flash:nitro");
      expect(stages[1].reasoning).toBe("minimal");
    });

    it("unknown language code falls through to the default rule", () => {
      const stages = resolveTranslationStages("zz", 100);
      expect(stages.length).toBe(2);
      expect(stages[0].model).toBe("openai/gpt-5.6-luna:nitro");
      expect(stages[1].model).toBe("google/gemini-3.7-flash:nitro");
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

    it("maps reasoning='none' to reasoning:{enabled:false} (NOT field omission)", async () => {
      // Luna reasons adaptively (and bills hidden tokens) unless thinking is
      // explicitly disabled — 'none' must be sent as {enabled: false}.
      mockOpenRouterOk("Hallo.");
      await translateTextWithLLM({ ...callArgs, reasoning: "none" });
      const callArg = vi.mocked(generateText).mock.calls[0][0];
      expect(callArg.providerOptions).toEqual({
        openrouter: { reasoning: { enabled: false } },
      });
    });

    it("passes provider constraints and temperature through to the call", async () => {
      mockOpenRouterOk("Hallo.");
      await translateTextWithLLM({
        ...callArgs,
        reasoning: "none",
        provider: { max_price: { completion: 2 } },
        temperature: 1,
      });
      const callArg = vi.mocked(generateText).mock.calls[0][0];
      expect(callArg.temperature).toBe(1);
      expect(callArg.providerOptions).toEqual({
        openrouter: {
          reasoning: { enabled: false },
          provider: { max_price: { completion: 2 } },
        },
      });
    });
  });

  describe("translateBestOfN", () => {
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

    const promptArgs = {
      text: "Could you repeat that?",
      sourceLang: "en",
      targetLang: "is",
      targetLangName: "Icelandic",
      targetLangNativeName: "Íslenska",
      targetRegion: "Iceland",
      addressesSomeone: true,
      referentGender: "male" as const,
    };

    const stage = {
      model: "openai/gpt-5.6-luna:nitro",
      reasoning: "none" as const,
      maxOutputTokens: 4_000,
      provider: { max_price: { completion: 2 } },
      samples: { total: 3, extraTemperature: 1 },
      judge: {
        model: "openai/gpt-5.6-luna:nitro",
        reasoning: "none" as const,
        provider: { max_price: { completion: 2 } },
        maxRetries: 2,
      },
    };

    function mockCall(content: string, finishReason = "stop") {
      vi.mocked(generateText).mockResolvedValueOnce({
        text: content,
        finishReason,
        usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 },
      } as any);
    }

    it("skips the judge when all candidates agree", async () => {
      mockCall("Geturðu endurtekið þetta?");
      mockCall("Geturðu endurtekið þetta?");
      mockCall("Geturðu endurtekið þetta?");
      const bo = await translateBestOfN({ ...promptArgs, stage });
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(3);
      expect(bo.result.ok && bo.result.text).toBe("Geturðu endurtekið þetta?");
      expect(bo.meta).toEqual({
        nUnique: 1,
        judgeUsed: false,
        judgeFallback: false,
        candidateFailures: 0,
      });
      expect(bo.telemetryList).toHaveLength(3);
    });

    it("runs the anchor at temp 0 and extras at extraTemperature, all with no-thinking + price cap", async () => {
      mockCall("A.");
      mockCall("A.");
      mockCall("A.");
      await translateBestOfN({ ...promptArgs, stage });
      const calls = vi.mocked(generateText).mock.calls.map((c) => c[0]);
      expect(calls.map((c) => c.temperature)).toEqual([0, 1, 1]);
      for (const c of calls) {
        expect(c.providerOptions).toEqual({
          openrouter: {
            reasoning: { enabled: false },
            provider: { max_price: { completion: 2 } },
          },
        });
      }
    });

    it("asks the judge when candidates differ and returns its pick", async () => {
      mockCall("A.");
      mockCall("B.");
      mockCall("C.");
      mockCall("2"); // judge verdict (1-based id into the shuffled list)
      const bo = await translateBestOfN({ ...promptArgs, stage });
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(4);
      expect(bo.meta.judgeUsed).toBe(true);
      expect(bo.meta.judgeFallback).toBe(false);
      expect(bo.meta.nUnique).toBe(3);
      expect(bo.result.ok).toBe(true);
      if (bo.result.ok) {
        expect(["A.", "B.", "C."]).toContain(bo.result.text);
      }
      // Judge prompt contained all three candidates.
      const judgePrompt = vi.mocked(generateText).mock.calls[3][0].prompt as string;
      expect(judgePrompt).toContain('<candidate id="1">');
      expect(judgePrompt).toContain('<candidate id="3">');
      expect(judgePrompt).toContain("<source>Could you repeat that?</source>");
      // 3 candidates + 1 judge in the telemetry, roles tagged.
      expect(bo.telemetryList.map((t) => t.role)).toEqual([
        "candidate",
        "candidate",
        "candidate",
        "judge",
      ]);
    });

    it("falls back to the temp-0 anchor on an unparseable judge verdict", async () => {
      mockCall("A.");
      mockCall("B.");
      mockCall("C.");
      mockCall("I think they are all lovely");
      const bo = await translateBestOfN({ ...promptArgs, stage });
      expect(bo.meta.judgeFallback).toBe(true);
      // Anchor-first order: candidate #1 (temp 0) survived, so it's the pick.
      expect(bo.result.ok && bo.result.text).toBe("A.");
    });

    it("retries the judge on transport errors, then succeeds", async () => {
      mockCall("A.");
      mockCall("B.");
      mockCall("C.");
      vi.mocked(generateText).mockRejectedValueOnce(new Error("network down"));
      mockCall("1");
      const bo = await translateBestOfN({ ...promptArgs, stage });
      expect(bo.meta.judgeUsed).toBe(true);
      expect(bo.meta.judgeFallback).toBe(false);
      const judgeEntries = bo.telemetryList.filter((t) => t.role === "judge");
      expect(judgeEntries.map((t) => t.judgeAttempt)).toEqual([1, 2]);
      expect(judgeEntries[0].error).toMatch(/network down/);
    });

    it("falls back to the anchor when the judge exhausts all retries", async () => {
      mockCall("A.");
      mockCall("B.");
      mockCall("C.");
      vi.mocked(generateText).mockRejectedValue(new Error("permanently down"));
      const bo = await translateBestOfN({ ...promptArgs, stage });
      expect(bo.meta.judgeFallback).toBe(true);
      expect(bo.result.ok && bo.result.text).toBe("A.");
      // 1 initial + maxRetries=2 → 3 judge attempts.
      expect(bo.telemetryList.filter((t) => t.role === "judge")).toHaveLength(3);
    });

    it("survives individual candidate failures as long as one candidate lands", async () => {
      vi.mocked(generateText).mockRejectedValueOnce(new Error("boom"));
      mockCall("B.");
      mockCall("", "length"); // truncated → dropped from the pool
      const bo = await translateBestOfN({ ...promptArgs, stage });
      expect(bo.result.ok && bo.result.text).toBe("B.");
      expect(bo.meta).toEqual({
        nUnique: 1,
        judgeUsed: false,
        judgeFallback: false,
        candidateFailures: 2,
      });
      const errors = bo.telemetryList.filter((t) => t.error !== undefined);
      expect(errors).toHaveLength(2);
    });

    it("fails the stage only when ALL candidates fail", async () => {
      vi.mocked(generateText).mockRejectedValue(new Error("everything down"));
      const bo = await translateBestOfN({ ...promptArgs, stage });
      expect(bo.result.ok).toBe(false);
      if (!bo.result.ok) {
        expect(bo.result.reason).toBe("http_error");
        expect(bo.result.detail).toMatch(/all 3 candidates failed/);
      }
      expect(bo.meta.candidateFailures).toBe(3);
      expect(bo.meta.judgeUsed).toBe(false);
    });
  });

  describe("buildJudgePrompt", () => {
    it("mirrors the translation prompt's context block and lists candidates", () => {
      const args = {
        text: "Hi.",
        sourceLang: "en",
        targetLang: "is",
        targetLangName: "Icelandic",
        targetLangNativeName: "Íslenska",
        targetRegion: "Iceland",
        addressesSomeone: true,
        formality: "neutral" as const,
        referentGender: "female" as const,
      };
      const p = buildJudgePrompt(args, ["Halló.", "Hæ."]);
      expect(p).toContain("<referent_gender>female</referent_gender>");
      expect(p).toContain("<register>neutral</register>");
      expect(p).toContain('<candidate id="1">Halló.</candidate>');
      expect(p).toContain('<candidate id="2">Hæ.</candidate>');
      expect(p).toMatch(/Icelandic \(Íslenska\) translation reviewer/);
      expect(p).toMatch(/Output only the id number/);
    });
  });
});
