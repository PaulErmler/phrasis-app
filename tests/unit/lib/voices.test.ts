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
  getVoiceForLanguageVariant,
  resolveCardSpeakerGenders,
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

  it('getAllVoicesByLanguageCode includes non-active-provider voices (settings UI surface)', () => {
    // Mandarin runs on Gemini but keeps its Google Chirp3 pool listed for a
    // one-line revert; the full curated set must surface both providers.
    const all = getAllVoicesByLanguageCode('zh');
    expect(all.some((v) => v.provider === 'google')).toBe(true);
    expect(all.some((v) => v.provider === 'gemini')).toBe(true);
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

describe('Spanish runs on Gemini TTS', () => {
  it('es and es_latam resolve to bare Gemini voices', () => {
    for (const code of ['es', 'es_latam']) {
      const active = getVoicesByLanguageCode(code);
      expect(active.length).toBeGreaterThan(0);
      expect(active.every((v) => v.provider === 'gemini')).toBe(true);
      // Single-accent → bare voice name (locale comes from geminiBcp47).
      expect(active.every((v) => !v.apiCode.includes('@'))).toBe(true);
    }
  });

  it('es_mixed uses accent-tagged Gemini voices for both es-ES and es-US', () => {
    const active = getVoicesByLanguageCode('es_mixed');
    expect(active.every((v) => v.provider === 'gemini')).toBe(true);
    expect(active.some((v) => v.apiCode.endsWith('@es-ES'))).toBe(true);
    expect(active.some((v) => v.apiCode.endsWith('@es-US'))).toBe(true);
  });

  it('getVoiceForLanguageVariant picks the matching Gemini accent for es_mixed', () => {
    // Repeat a few times since selection is random within the matched pool.
    for (let i = 0; i < 10; i++) {
      expect(getVoiceForLanguageVariant('es_mixed', 'es-ES')).toMatch(/@es-ES$/);
      expect(getVoiceForLanguageVariant('es_mixed', 'es-US')).toMatch(/@es-US$/);
    }
  });
});

describe('resolveCardSpeakerGenders', () => {
  it('definitive speakerGender is the source of truth and mirrors into audio', () => {
    const r = resolveCardSpeakerGenders(
      { speakerGender: 'female', audioSpeakerGender: undefined, userCreated: false },
      'seed1',
    );
    expect(r.audioSpeakerGender).toBe('female');
    // Mirrors into audioSpeakerGender; never patches speakerGender.
    expect(r.genderPatch).toEqual({ audioSpeakerGender: 'female' });
  });

  it('definitive + already-matching audio writes no patch', () => {
    const r = resolveCardSpeakerGenders(
      { speakerGender: 'male', audioSpeakerGender: 'male', userCreated: true },
      'seed1',
    );
    expect(r.audioSpeakerGender).toBe('male');
    expect(r.genderPatch).toEqual({});
  });

  it('custom + neutral preserves speakerGender and only resolves audio', () => {
    const r = resolveCardSpeakerGenders(
      { speakerGender: 'neutral', audioSpeakerGender: undefined, userCreated: true },
      'seed-custom',
    );
    expect(['male', 'female']).toContain(r.audioSpeakerGender);
    // Never patches speakerGender for custom (LLM owns it); only audio.
    expect(r.genderPatch.speakerGender).toBeUndefined();
    expect(r.genderPatch.audioSpeakerGender).toBe(r.audioSpeakerGender);
  });

  it('premade + undefined coin-flips BOTH fields to the same value', () => {
    const r = resolveCardSpeakerGenders(
      { speakerGender: undefined, audioSpeakerGender: undefined, userCreated: false },
      'seed-premade',
    );
    expect(r.genderPatch.speakerGender).toBe(r.audioSpeakerGender);
    expect(r.genderPatch.audioSpeakerGender).toBe(r.audioSpeakerGender);
  });

  it('is deterministic per seed (retry-stable, no re-roll)', () => {
    const a = resolveCardSpeakerGenders(
      { speakerGender: undefined, audioSpeakerGender: undefined, userCreated: false },
      'stable-seed',
    );
    const b = resolveCardSpeakerGenders(
      { speakerGender: undefined, audioSpeakerGender: undefined, userCreated: false },
      'stable-seed',
    );
    expect(a.audioSpeakerGender).toBe(b.audioSpeakerGender);
  });

  it('preserves a prior audioSpeakerGender instead of re-rolling', () => {
    const r = resolveCardSpeakerGenders(
      { speakerGender: undefined, audioSpeakerGender: 'female', userCreated: false },
      'seed-x',
    );
    expect(r.audioSpeakerGender).toBe('female');
  });
});
