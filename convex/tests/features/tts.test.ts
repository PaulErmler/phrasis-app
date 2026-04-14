/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";
import { normalizeForComparison, textsMatch } from "../../features/tts";

// tts.ts is a helpers file (no Convex functions exported). We exercise the
// re-exported text-comparison helpers which power TTS validation.
describe("features/tts helpers", () => {
  describe("normalizeForComparison", () => {
    it("lowercases and strips punctuation / surrounding whitespace", () => {
      expect(normalizeForComparison("  Hello, world! ")).toBe("hello world");
    });

    it("collapses runs of whitespace", () => {
      expect(normalizeForComparison("a   b\tc\n d")).toBe("a b c d");
    });

    it("handles NFC normalization on accented text", () => {
      const composed = "caf\u00e9"; // café
      const decomposed = "cafe\u0301"; // cafe + combining acute
      expect(normalizeForComparison(composed)).toBe(
        normalizeForComparison(decomposed),
      );
    });
  });

  describe("textsMatch", () => {
    it("accepts identical strings", () => {
      expect(textsMatch("Hola.", "Hola")).toBe(true);
    });

    it("accepts a single character difference (edit distance = 1)", () => {
      expect(textsMatch("hola", "holas")).toBe(true);
    });

    it("rejects two or more character differences", () => {
      expect(textsMatch("hello world", "goodbye world")).toBe(false);
    });

    it("ignores case and trailing punctuation", () => {
      expect(textsMatch("Hola!", "hola")).toBe(true);
    });
  });
});
