/**
 * Completeness / consistency tests for the voices ↔ languages split.
 *
 * Acts as a lint-in-CI: fails if anyone adds a language to SUPPORTED_LANGUAGES
 * without a matching VOICE_POOLS entry, or adds voice_ids that contradict the
 * language's active TTS provider.
 */
import { describe, it, expect } from 'vitest';
import { SUPPORTED_LANGUAGES } from '../../../lib/languages';
import {
  VOICE_POOLS,
  getVoicesByLanguageCode,
  getAllVoicesByLanguageCode,
} from '../../../lib/voices';

describe('voice pools completeness', () => {
  it('every language in SUPPORTED_LANGUAGES has a voice pool', () => {
    const missing = SUPPORTED_LANGUAGES.filter(
      (lang) => !(lang.code in VOICE_POOLS),
    ).map((lang) => lang.code);
    expect(
      missing,
      `Languages without a VOICE_POOLS entry in lib/voices.ts: ${missing.join(', ') || '(none)'}`,
    ).toEqual([]);
  });

  it('every language pool is non-empty', () => {
    const empty = SUPPORTED_LANGUAGES.filter(
      (lang) => (VOICE_POOLS[lang.code]?.length ?? 0) === 0,
    ).map((lang) => lang.code);
    expect(
      empty,
      `Languages with zero voices in VOICE_POOLS: ${empty.join(', ') || '(none)'}`,
    ).toEqual([]);
  });

  it('every language has at least one voice for its active TTS provider', () => {
    const bad: string[] = [];
    for (const lang of SUPPORTED_LANGUAGES) {
      const pool = VOICE_POOLS[lang.code] ?? [];
      const match = pool.filter((v) => v.provider === lang.ttsProvider);
      if (match.length === 0) {
        bad.push(`${lang.code} (ttsProvider=${lang.ttsProvider})`);
      }
    }
    expect(
      bad,
      `Languages whose ttsProvider has no voices in the pool: ${bad.join(', ') || '(none)'}`,
    ).toEqual([]);
  });

  it('VOICE_POOLS contains no entries for unknown language codes', () => {
    const known = new Set(SUPPORTED_LANGUAGES.map((l) => l.code));
    const orphans = Object.keys(VOICE_POOLS).filter((code) => !known.has(code));
    expect(
      orphans,
      `Voice pools for codes not in SUPPORTED_LANGUAGES: ${orphans.join(', ') || '(none)'}`,
    ).toEqual([]);
  });

  it('every voice in every pool has a non-empty apiCode and name', () => {
    for (const [code, pool] of Object.entries(VOICE_POOLS)) {
      for (const voice of pool) {
        expect(voice.apiCode, `${code}/${voice.name} apiCode`).toMatch(/.+/);
        expect(voice.name, `${code} voice name`).toMatch(/.+/);
      }
    }
  });

  it('getVoicesByLanguageCode excludes dormant voices', () => {
    for (const lang of SUPPORTED_LANGUAGES) {
      const active = getVoicesByLanguageCode(lang.code);
      const dormant = active.filter((v) => v.active === false);
      expect(
        dormant,
        `${lang.code} leaked dormant voices: ${dormant.map((v) => v.name).join(', ')}`,
      ).toEqual([]);
    }
  });

  it('getAllVoicesByLanguageCode includes dormant voices (settings UI surface)', () => {
    // Mandarin has dormant Azure Dragon HD voices in the curated pool.
    const all = getAllVoicesByLanguageCode('zh');
    const hasDormant = all.some((v) => v.active === false);
    expect(hasDormant).toBe(true);
  });

  it('every language has at least one active Google voice after dormancy filter', () => {
    const bad: string[] = [];
    for (const lang of SUPPORTED_LANGUAGES) {
      const active = getVoicesByLanguageCode(lang.code);
      if (active.length === 0) bad.push(lang.code);
    }
    expect(
      bad,
      `Languages with no selectable voice after filtering: ${bad.join(', ') || '(none)'}`,
    ).toEqual([]);
  });
});

describe('Persian (fa) voice pool', () => {
  it('resolves to the Gemini pool for the active provider', () => {
    const active = getVoicesByLanguageCode('fa');
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((v) => v.provider === 'gemini')).toBe(true);
    // The Azure fallback must NOT surface while ttsProvider is 'gemini'.
    expect(active.some((v) => v.provider === 'azure')).toBe(false);
  });

  it('keeps the Azure fa-IR fallback in the full curated set', () => {
    const all = getAllVoicesByLanguageCode('fa');
    const azure = all.filter((v) => v.provider === 'azure');
    expect(azure.map((v) => v.apiCode).sort()).toEqual([
      'fa-IR-DilaraNeural',
      'fa-IR-FaridNeural',
    ]);
    // Wrapped in activate() so flipping ttsProvider to 'azure' would surface them.
    expect(azure.every((v) => v.active === true)).toBe(true);
  });
});

describe('Arabic dialects on the global Gemini voice name the dialect in the prompt', () => {
  // The shared/global Gemini Arabic voice (GEMINI_CORE) has a bare apiCode (no
  // "@locale" suffix), so convex/lib/tts/gemini.ts derives the locale from
  // toGeminiBcp47 — which is `ar-001` (World Arabic) for EVERY Arabic dialect.
  // That locale can't tell Levantine from MSA/Saudi/Iraqi, and the prompt
  // builder strips the name's "(Levantine)" parenthetical. So any Arabic
  // language served by the global Gemini voice MUST set `ttsPromptName` to name
  // the dialect in the prose — the only signal Gemini gets. This guards against
  // flipping another Arabic dialect to Gemini and silently losing the dialect.
  const arabicOnGlobalGeminiVoice = SUPPORTED_LANGUAGES.filter((lang) => {
    if (!lang.code.startsWith('ar')) return false;
    return getVoicesByLanguageCode(lang.code).some(
      (v) => v.provider === 'gemini' && !v.apiCode.includes('@'),
    );
  });

  it('detects at least the Levantine entry (guards against a vacuous pass)', () => {
    expect(arabicOnGlobalGeminiVoice.map((l) => l.code)).toContain('ar_lev');
  });

  it('every such language sets a non-empty ttsPromptName', () => {
    const missing = arabicOnGlobalGeminiVoice
      .filter((lang) => !lang.ttsPromptName?.trim())
      .map((lang) => lang.code);
    expect(
      missing,
      `Arabic languages served by the global Gemini voice (locale collapses to ar-001) must set ttsPromptName so the dialect is named in the TTS prompt: ${missing.join(', ') || '(none)'}`,
    ).toEqual([]);
  });
});
