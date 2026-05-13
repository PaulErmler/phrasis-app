/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import {
  getTranslationConfigForLanguage,
  DEFAULT_LLM_TRANSLATION_MODEL,
} from "../../../lib/languages";

describe("lib/languages — getTranslationConfigForLanguage", () => {
  it("returns provider='google' for English (source-only, never translated)", () => {
    const cfg = getTranslationConfigForLanguage("en");
    expect(cfg.provider).toBe("google");
    expect(cfg.model).toBeUndefined();
  });

  it("defaults non-English to provider='openrouter' with the default model", () => {
    const cfg = getTranslationConfigForLanguage("de");
    expect(cfg.provider).toBe("openrouter");
    expect(cfg.model).toBe(DEFAULT_LLM_TRANSLATION_MODEL);
    expect(cfg.reasoning).toBeUndefined(); // → hybrid rule applies
  });

  it("populates targetLangName from the English language name", () => {
    expect(getTranslationConfigForLanguage("de").targetLangName).toBe("German");
    expect(getTranslationConfigForLanguage("fr").targetLangName).toBe("French");
  });

  it("populates targetRegion correctly for region-specific variants", () => {
    expect(getTranslationConfigForLanguage("es").targetRegion).toBe("Spain");
    expect(getTranslationConfigForLanguage("es_latam").targetRegion).toBe(
      "Latin America",
    );
    expect(getTranslationConfigForLanguage("zh").targetRegion).toBe(
      "Mainland China",
    );
  });

  it("falls back to provider='google' for unknown language codes", () => {
    const cfg = getTranslationConfigForLanguage("klingon-xyz");
    expect(cfg.provider).toBe("google");
  });

  it("returns provider='openrouter' for all 16 production target languages", () => {
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
      const cfg = getTranslationConfigForLanguage(code);
      expect(cfg.provider, `code=${code}`).toBe("openrouter");
      expect(cfg.model, `code=${code}`).toBe(DEFAULT_LLM_TRANSLATION_MODEL);
    }
  });
});
