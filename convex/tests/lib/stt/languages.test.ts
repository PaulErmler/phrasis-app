import { describe, it, expect } from 'vitest';

import {
  MAI_TRANSCRIBE_2_LANGUAGES,
  STT_UNLISTED_BUT_WORKING,
  toSttLanguage,
} from '../../../lib/stt/languages';
import { SUPPORTED_LANGUAGES, getSttBackend } from '../../../../lib/languages';

describe('lib/stt/languages toSttLanguage', () => {
  it('collapses regional and script variants onto the bare code', () => {
    expect(toSttLanguage('en')).toBe('en');
    expect(toSttLanguage('en_gb')).toBe('en');
    expect(toSttLanguage('es_latam')).toBe('es');
    expect(toSttLanguage('es_mixed')).toBe('es');
    expect(toSttLanguage('pt_pt')).toBe('pt');
    expect(toSttLanguage('zh_traditional')).toBe('zh');
    expect(toSttLanguage('yue_traditional')).toBe('yue');
    expect(toSttLanguage('vi_south')).toBe('vi');
    expect(toSttLanguage('ar_lev')).toBe('ar');
    expect(toSttLanguage('sw_tz')).toBe('sw');
    expect(toSttLanguage('fil')).toBe('fil');
    expect(toSttLanguage('nb')).toBe('nb');
  });

  it('keeps the legacy cmn alias', () => {
    expect(toSttLanguage('cmn')).toBe('zh');
  });

  it('has an STT decision for every supported code (no silent gaps)', () => {
    // A new language whose bare code the model does not list must be probed
    // live and either added to STT_UNLISTED_BUT_WORKING, routed to the
    // Gemini backend, or shipped with supportsStt: false (each is a
    // decision, so such a language is not a gap). Landing here by accident
    // is the failure this guards.
    const gaps = SUPPORTED_LANGUAGES.filter(
      (l) => l.supportsStt && getSttBackend(l.code) === 'mai-transcribe-2',
    )
      .map((l) => l.code)
      .filter((code) => {
        const stt = toSttLanguage(code);
        return (
          !MAI_TRANSCRIBE_2_LANGUAGES.has(stt) &&
          !STT_UNLISTED_BUT_WORKING.has(stt)
        );
      });
    expect(gaps).toEqual([]);
  });

  it('lists only the languages that are actually unlisted', () => {
    // If Microsoft adds hr/sr to the documented set, drop them from the
    // unlisted set rather than carrying a stale exception.
    for (const code of STT_UNLISTED_BUT_WORKING) {
      expect(MAI_TRANSCRIBE_2_LANGUAGES.has(code)).toBe(false);
    }
    expect([...STT_UNLISTED_BUT_WORKING].sort()).toEqual(['hr', 'sr']);
  });

  it('routes to Gemini only languages MAI does not list', () => {
    const geminiRouted = SUPPORTED_LANGUAGES.filter(
      (l) => l.supportsStt && getSttBackend(l.code) === 'gemini-flash-lite',
    ).map((l) => l.code);
    expect(geminiRouted).toEqual(['uz']);
    for (const code of geminiRouted) {
      expect(MAI_TRANSCRIBE_2_LANGUAGES.has(toSttLanguage(code))).toBe(false);
    }
  });
});
