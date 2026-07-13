/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import {
  getTranslationConfigForLanguage,
  resolveTranslationStages,
} from "../../../lib/languages";

describe("lib/languages — getTranslationConfigForLanguage", () => {
  it("returns provider='google' for English (source-only, never translated)", () => {
    const cfg = getTranslationConfigForLanguage("en");
    expect(cfg.provider).toBe("google");
  });

  it("defaults non-English to provider='openrouter'", () => {
    expect(getTranslationConfigForLanguage("de").provider).toBe("openrouter");
    expect(getTranslationConfigForLanguage("fr").provider).toBe("openrouter");
  });

  it("populates targetLangName + native name from the language record", () => {
    const de = getTranslationConfigForLanguage("de");
    expect(de.targetLangName).toBe("German");
    expect(de.targetLangNativeName).toBe("Deutsch");
  });

  it("uses translationName override when present (Hebrew → Modern Hebrew)", () => {
    expect(getTranslationConfigForLanguage("he").targetLangName).toBe(
      "Modern Hebrew",
    );
  });

  it("uses translationName override when present (Thai → Standard Thai)", () => {
    expect(getTranslationConfigForLanguage("th").targetLangName).toBe(
      "Standard Thai",
    );
  });

  it("populates targetRegion correctly for region-specific variants", () => {
    expect(getTranslationConfigForLanguage("es").targetRegion).toBe("Spain");
    expect(getTranslationConfigForLanguage("es_latam").targetRegion).toBe(
      "Latin America",
    );
    expect(getTranslationConfigForLanguage("zh").targetRegion).toBe(
      "Mainland China",
    );
    expect(getTranslationConfigForLanguage("ar_lev").targetRegion).toBe(
      "the Levant (Lebanon, Syria, Palestine, Jordan)",
    );
  });

  it("falls back to provider='google' for unknown language codes", () => {
    expect(getTranslationConfigForLanguage("klingon-xyz").provider).toBe(
      "google",
    );
  });

  it("returns provider='openrouter' for the production target languages", () => {
    const targets = [
      "es",
      "es_latam",
      "fr",
      "de",
      "it",
      "pt",
      "ru",
      "hi",
      "zh",
      "ja",
      "ko",
      "vi",
      "sv",
      "fi",
      "nl",
      "el",
      "ar",
    ];
    for (const code of targets) {
      expect(getTranslationConfigForLanguage(code).provider, `code=${code}`).toBe(
        "openrouter",
      );
    }
  });
});

describe("lib/languages — resolveTranslationStages", () => {
  it("returns the default gemini_35_flash_nitro_minimal chain (primary + one fallback) for an unruled language", () => {
    const stages = resolveTranslationStages("nl", 50);
    expect(stages.length).toBe(2);
    expect(stages[0].model).toBe("google/gemini-3.5-flash:nitro");
    expect(stages[0].reasoning).toBe("minimal");
    // The single fallback retries the same config before the Google safety net.
    expect(stages[1]).toEqual(stages[0]);
  });

  it("is length-agnostic (length-hybrid branching was retired)", () => {
    expect(resolveTranslationStages("nl", 5)).toEqual(
      resolveTranslationStages("nl", 500),
    );
  });

  it("de uses gemini_35_flash_nitro_minimal (primary + one fallback)", () => {
    const stages = resolveTranslationStages("de", 50);
    expect(stages.length).toBe(2);
    const nitroMinimal = {
      model: "google/gemini-3.5-flash:nitro",
      reasoning: "minimal",
      maxOutputTokens: 4_000,
    };
    expect(stages[0]).toEqual(nitroMinimal);
    expect(stages[1]).toEqual(nitroMinimal);
  });

  it("fr uses gemini_35_flash_nitro_minimal (primary + one fallback)", () => {
    const stages = resolveTranslationStages("fr", 50);
    expect(stages.length).toBe(2);
    const nitroMinimal = {
      model: "google/gemini-3.5-flash:nitro",
      reasoning: "minimal",
      maxOutputTokens: 4_000,
    };
    expect(stages[0]).toEqual(nitroMinimal);
    expect(stages[1]).toEqual(nitroMinimal);
  });

  it("ruleOverride forces the retranslation_high chain regardless of language", () => {
    const stages = resolveTranslationStages("de", 100, {
      ruleOverride: "retranslation_high",
    });
    expect(stages.length).toBe(1);
    expect(stages[0].model).toBe("google/gemini-3.1-pro-preview");
    expect(stages[0].reasoning).toBe("medium");
  });
});
