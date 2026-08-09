/// <reference types="vite/client" />
import { describe, it, expect } from "vitest";

import { augmentSearchQuery, MAX_SEARCH_TERMS } from "../../features/library";
import { SUPPORTED_LANGUAGES } from "../../../lib/languages";

/**
 * Script-class coverage for `augmentSearchQuery`.
 *
 * The regression this file exists for: the term splitter was
 * `/[^\p{L}\p{N}]+/u`, which treats COMBINING MARKS (`\p{M}`) as separators.
 * Devanagari matras, Thai tone marks, Hebrew niqqud and Arabic harakat are
 * marks, so a 9-word Hindi query counted as 17 terms, blew the 16-term cap,
 * and the over-cap branch rebuilt the query from those pieces — emitting bare
 * consonants (`मैं` → `म`) that match nothing in the index. Library search
 * returned zero results for eight supported languages.
 *
 * Two properties are asserted for every script class we support:
 *
 *  1. PRESERVATION — a query under the cap comes back with the original
 *     string intact (segments may be appended). This is what fails when the
 *     splitter miscounts: an inflated count triggers the rebuild and shreds
 *     the query.
 *  2. CAP COMPLIANCE — the result stays within `MAX_SEARCH_TERMS` as the
 *     search index counts terms, or the query throws instead of returning.
 *
 * `countTerms` below is deliberately NOT the production regex. The previous
 * test copied that regex as its own oracle, so it asserted the implementation
 * agreed with itself and passed with the bug intact. This one enumerates the
 * SEPARATORS (whitespace, punctuation, symbols) instead of the keepers —
 * an independent construction that, unlike the buggy version, never treats a
 * combining mark as a boundary.
 */
const countTerms = (q: string) => q.split(/[\s\p{P}\p{S}]+/u).filter(Boolean).length;

/** The pre-fix splitter, kept so the samples can be proven adversarial. */
const legacyCountTerms = (q: string) =>
  q.split(/[^\p{L}\p{N}]+/u).filter(Boolean).length;

interface ScriptClass {
  /** Human name for the failure message. */
  name: string;
  /** Every SUPPORTED_LANGUAGES code written in this script. */
  codes: string[];
  /** A realistic learner-style query. */
  query: string;
  /**
   * True when this class carries combining marks and the sample is sized so
   * the OLD splitter exceeds the cap while the correct one does not — i.e.
   * the sample actually reproduces the bug. Asserted below, so nobody can
   * shorten a sample and silently defang the regression test.
   */
  triggersLegacyBug: boolean;
}

const SCRIPT_CLASSES: ScriptClass[] = [
  {
    name: "Latin, no diacritics",
    codes: ["en", "en_gb", "en_us", "en_au", "nl", "sv", "da", "nb", "fi", "et",
      "id", "ms", "fil", "sw", "sw_tz", "de", "it"],
    query: "I will go to school tomorrow and meet my friends",
    triggersLegacyBug: false,
  },
  {
    name: "Latin with precomposed diacritics (NFC)",
    codes: ["es", "es_latam", "es_mixed", "fr", "pt", "pt_pt", "ro", "ca", "pl",
      "sk", "cs", "hr", "sl", "lt", "lv", "is", "hu", "tr", "sr"],
    query: "Añoréis la canción más allá del jardín pequeño",
    triggersLegacyBug: false,
  },
  {
    name: "Latin with decomposed diacritics (NFD)",
    codes: ["es", "fr", "pt", "cs", "pl", "tr"],
    // Same text decomposed — the accents are standalone combining marks, the
    // form a macOS paste or some IMEs produce.
    query: "Añoréis la canción más allá del jardín pequeño después del café".normalize("NFD"),
    triggersLegacyBug: true,
  },
  {
    name: "Vietnamese (stacked tone + vowel marks, NFD)",
    codes: ["vi", "vi_south"],
    query: "Tôi sẽ đến trường vào ngày mai và gặp bạn bè ở quán cà phê".normalize("NFD"),
    triggersLegacyBug: true,
  },
  {
    name: "Cyrillic",
    codes: ["ru", "uk", "bg"],
    query: "Я завтра пойду в школу и встречусь с друзьями",
    triggersLegacyBug: false,
  },
  {
    name: "Greek",
    codes: ["el"],
    query: "Θα πάω στο σχολείο αύριο και θα δω τους φίλους μου",
    triggersLegacyBug: false,
  },
  {
    name: "Devanagari (abugida, matras)",
    codes: ["hi"],
    query: "मैं कल स्कूल जाऊंगा और अपने दोस्तों से मिलूंगा",
    triggersLegacyBug: true,
  },
  {
    name: "Bengali (abugida)",
    codes: ["bn"],
    query: "আমি আগামীকাল স্কুলে যাব এবং আমার বন্ধুদের সাথে দেখা করব",
    triggersLegacyBug: true,
  },
  {
    name: "Tamil (abugida)",
    codes: ["ta"],
    query: "நான் நாளை பள்ளிக்குச் செல்வேன் என் நண்பர்களைச் சந்திப்பேன்",
    triggersLegacyBug: true,
  },
  {
    name: "Telugu (abugida)",
    codes: ["te"],
    query: "నేను రేపు పాఠశాలకు వెళ్తాను నా స్నేహితులను కలుస్తాను",
    triggersLegacyBug: true,
  },
  {
    name: "Thai (marks AND no word boundaries)",
    codes: ["th"],
    query: "พูดช้าๆหน่อยได้ไหมครับ ผมไม่เข้าใจ ช่วยพูดอีกครั้งได้ไหม ขอบคุณมากครับ",
    triggersLegacyBug: true,
  },
  {
    name: "Hebrew (abjad with niqqud)",
    codes: ["he"],
    query: "אֲנִי הוֹלֵךְ לְבֵית הַסֵּפֶר בַּבֹּקֶר",
    triggersLegacyBug: true,
  },
  {
    name: "Arabic (abjad with harakat)",
    codes: ["ar", "ar_sa", "ar_eg", "ar_iq", "ar_lev"],
    query: "ذَهَبْتُ إِلَى الْمَدْرَسَةِ فِي الصَّبَاحِ",
    triggersLegacyBug: true,
  },
  {
    name: "Persian (abjad with harakat)",
    codes: ["fa"],
    query: "مَنْ فَرْدا بِهْ مَدْرِسِهْ خواهَمْ رَفْت",
    triggersLegacyBug: true,
  },
  {
    name: "Han (no word boundaries)",
    codes: ["zh", "zh_traditional", "yue", "yue_traditional"],
    query: "你真的體貼",
    triggersLegacyBug: false,
  },
  {
    name: "Japanese (no word boundaries)",
    codes: ["ja"],
    query: "私は日本語を勉強しています",
    triggersLegacyBug: false,
  },
  {
    name: "Korean (Hangul, space-delimited)",
    codes: ["ko"],
    query: "저는 내일 학교에 갈 거예요 그리고 친구들을 만날 거예요",
    triggersLegacyBug: false,
  },
];

describe("augmentSearchQuery — every supported script class", () => {
  it("covers every language in SUPPORTED_LANGUAGES", () => {
    const covered = new Set(SCRIPT_CLASSES.flatMap((c) => c.codes));
    const missing = SUPPORTED_LANGUAGES.map((l) => l.code).filter(
      (code) => !covered.has(code),
    );
    // A new language must be added to a class above (or given its own), or it
    // ships with no protection against this class of bug.
    expect(missing).toEqual([]);
  });

  it("references only real language codes", () => {
    const real = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));
    const bogus = [...new Set(SCRIPT_CLASSES.flatMap((c) => c.codes))].filter(
      (code) => !real.has(code),
    );
    expect(bogus).toEqual([]);
  });

  describe.each(SCRIPT_CLASSES)("$name", ({ codes, query, triggersLegacyBug }) => {
    // Course languages: English base + the class's first code as target,
    // mirroring how getLibraryCards passes course.{base,target}Languages.
    const courseLanguages = ["en", codes[0]];

    it("preserves the query verbatim instead of shredding it into fragments", () => {
      const out = augmentSearchQuery(query, courseLanguages);
      expect(out.startsWith(query)).toBe(true);
    });

    it("stays within the search index's term cap", () => {
      const out = augmentSearchQuery(query, courseLanguages);
      expect(countTerms(out)).toBeLessThanOrEqual(MAX_SEARCH_TERMS);
    });

    it("emits no token that is absent from the query text", () => {
      const out = augmentSearchQuery(query, courseLanguages);
      const appended = out.slice(query.length).split(/\s+/).filter(Boolean);
      // Everything added must be a real substring of the query (a segment),
      // never a fragment invented by splitting inside a word.
      for (const token of appended) {
        expect(query.includes(token)).toBe(true);
      }
    });

    if (triggersLegacyBug) {
      it("uses a sample that actually reproduces the pre-fix bug", () => {
        // Guards the guard: the old splitter must blow the cap on this sample
        // (so the preservation test above would fail on revert) while the
        // true term count stays under it.
        expect(legacyCountTerms(query)).toBeGreaterThan(MAX_SEARCH_TERMS);
        expect(countTerms(query)).toBeLessThanOrEqual(MAX_SEARCH_TERMS);
      });
    }
  });

  describe("no-word-boundary languages still get their segments", () => {
    it.each([
      ["zh", "你真的体贴", "体贴"],
      ["zh_traditional", "你真的體貼", "體貼"],
      ["yue_traditional", "你真的體貼", "體貼"],
      ["ja", "私は日本語を勉強しています", "日本語"],
      ["th", "พูดช้าๆหน่อยได้ไหมครับ", "พูด"],
    ])("%s query gains the mid-sentence token %s", (lang, query, midWord) => {
      const out = augmentSearchQuery(query, ["en", lang]);
      expect(out.split(/\s+/)).toContain(midWord);
    });
  });

  describe("over-cap queries", () => {
    const twentyWords = Array.from({ length: 20 }, (_, i) => `word${i}`).join(" ");

    it("truncates to the cap rather than letting the search throw", () => {
      const out = augmentSearchQuery(twentyWords, ["en", "es"]);
      expect(countTerms(out)).toBe(MAX_SEARCH_TERMS);
      expect(out.split(" ")[0]).toBe("word0");
    });

    it("keeps whole words when truncating — never mid-word fragments", () => {
      const longHindi =
        "मैं कल स्कूल जाऊंगा और अपने दोस्तों से मिलूंगा क्योंकि वे बहुत अच्छे हैं और हम साथ में पढ़ेंगे तथा खेलेंगे";
      const out = augmentSearchQuery(longHindi, ["en", "hi"]);
      const sourceWords = new Set(longHindi.split(/\s+/).filter(Boolean));
      for (const token of out.split(/\s+/).filter(Boolean)) {
        expect(sourceWords.has(token)).toBe(true);
      }
    });
  });
});
