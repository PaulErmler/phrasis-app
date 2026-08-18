/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import {
  dominantTextDirection,
  getCurrentTranslationVersion,
  getTextDirection,
  getTranslationConfigForLanguage,
  postProcessTranslation,
  resolveTranslationStages,
  SUPPORTED_LANGUAGES,
} from "../../../lib/languages";

describe("lib/languages — postProcessTranslation", () => {
  it("strips trailing underscore runs (the default step, every language)", () => {
    expect(postProcessTranslation("es", "Hola_")).toBe("Hola");
    expect(postProcessTranslation("es", "Hola.__")).toBe("Hola.");
    expect(postProcessTranslation("ar_lev", "أوه، أنا متأسفة._")).toBe(
      "أوه، أنا متأسفة.",
    );
  });

  it("strips whitespace mixed into the trailing run", () => {
    expect(postProcessTranslation("es", "Hola _ ")).toBe("Hola");
    expect(postProcessTranslation("es", "Hola. ")).toBe("Hola.");
  });

  it("keeps interior underscores (could be a deliberate blank)", () => {
    expect(postProcessTranslation("es", "a_b")).toBe("a_b");
    expect(postProcessTranslation("es", "fill _ in the blank")).toBe(
      "fill _ in the blank",
    );
  });

  it("is idempotent and safe on clean/empty strings", () => {
    expect(postProcessTranslation("es", "Hola.")).toBe("Hola.");
    expect(postProcessTranslation("es", "")).toBe("");
    expect(
      postProcessTranslation("es", postProcessTranslation("es", "Hola._")),
    ).toBe("Hola.");
  });

  it("applies the default for unknown language codes too", () => {
    expect(postProcessTranslation("not-a-language", "x_")).toBe("x");
  });
});

describe("lib/languages — getTextDirection", () => {
  it("returns 'rtl' for every Arabic dialect, Hebrew, and Persian", () => {
    const rtlCodes = SUPPORTED_LANGUAGES.filter(
      (l) => l.code === "ar" || l.code.startsWith("ar_"),
    ).map((l) => l.code);
    expect(rtlCodes.length).toBeGreaterThanOrEqual(5);
    for (const code of [...rtlCodes, "he", "fa"]) {
      expect(getTextDirection(code), code).toBe("rtl");
    }
  });

  it("falls back to the base code for display-code variants", () => {
    expect(getTextDirection("ar-EG")).toBe("rtl");
    expect(getTextDirection("ar-LB")).toBe("rtl");
  });

  it("returns 'ltr' for LTR and unknown languages", () => {
    for (const code of ["en", "de", "el", "bn", "hi", "zh", "not-a-language"]) {
      expect(getTextDirection(code), code).toBe("ltr");
    }
  });
});

describe("lib/languages — dominantTextDirection", () => {
  // Regression: a chat explanation that OPENS with a target-language token
  // used to flip wholesale to RTL under dir="auto"'s first-strong-character
  // heuristic, putting English punctuation on the wrong side.
  it("keeps an English explanation LTR even when it opens with Arabic", () => {
    const text =
      '"وإنت" (w-inta / w-inti) means "And you?" in Levantine Arabic. ' +
      'It is a combination of the conjunction "و" (-w), meaning "and", ' +
      'and the pronoun "إنت" (inta), meaning "you".\n\n' +
      "- وإنت (w-inta) for a male.\n" +
      "- وإنتي (w-inti) for a female.\n" +
      "- وإنتو (w-intu) for a group or plural.";
    expect(dominantTextDirection(text)).toBe("ltr");
  });

  it("returns 'rtl' for a fully Arabic reply (with Latin brand names)", () => {
    expect(
      dominantTextDirection("مرحبا! كيف حالك اليوم؟ أنا بخير، شكرا لك (ok)"),
    ).toBe("rtl");
  });

  it("returns 'rtl' for Hebrew", () => {
    expect(dominantTextDirection("שלום, מה שלומך היום?")).toBe("rtl");
  });

  it("returns 'ltr' for plain English and for empty text", () => {
    expect(dominantTextDirection("Hello there, how are you?")).toBe("ltr");
    expect(dominantTextDirection("")).toBe("ltr");
  });
});

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

  it("bumps translationVersion for languages whose prompt pins script or register", () => {
    // Serbian: prompt now pins Cyrillic output.
    expect(getCurrentTranslationVersion("sr")).toBe(2);
    // Taiwanese Mandarin / Cantonese: prompt now pins vocabulary + register.
    expect(getCurrentTranslationVersion("zh_traditional")).toBe(3);
    expect(getCurrentTranslationVersion("yue")).toBe(3);
    expect(getCurrentTranslationVersion("yue_traditional")).toBe(3);
    expect(getCurrentTranslationVersion("th")).toBe(3);
    // Icelandic: bumped with the Aug 2026 Luna best-of-3 switch — the only
    // language whose existing rows regenerate under the new rule (native
    // speaker flagged systematic register/imperative errors).
    expect(getCurrentTranslationVersion("is")).toBe(2);
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
  it("returns the default luna_bo3 chain (Luna best-of-3 + Gemini fallback) for an unruled language", () => {
    const stages = resolveTranslationStages("nl", 50);
    expect(stages.length).toBe(2);
    expect(stages[0].model).toBe("openai/gpt-5.6-luna:nitro");
    expect(stages[0].reasoning).toBe("none");
    expect(stages[0].samples).toEqual({ total: 3, extraTemperature: 1 });
    // The fallback is Gemini 3.7 Flash Nitro (minimal), before the Google
    // safety net.
    expect(stages[1].model).toBe("google/gemini-3.7-flash:nitro");
    expect(stages[1].reasoning).toBe("minimal");
  });

  it("is length-agnostic (length-hybrid branching was retired)", () => {
    expect(resolveTranslationStages("nl", 5)).toEqual(
      resolveTranslationStages("nl", 500),
    );
  });

  it("de and fr use the luna_bo3 default (Luna best-of-3 + Gemini fallback)", () => {
    for (const code of ["de", "fr"]) {
      const stages = resolveTranslationStages(code, 50);
      expect(stages.length).toBe(2);
      expect(stages[0].model).toBe("openai/gpt-5.6-luna:nitro");
      expect(stages[0].judge?.model).toBe("openai/gpt-5.6-luna:nitro");
      expect(stages[1]).toEqual({
        model: "google/gemini-3.7-flash:nitro",
        reasoning: "minimal",
        maxOutputTokens: 4_000,
      });
    }
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
