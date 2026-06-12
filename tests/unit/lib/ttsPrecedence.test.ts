import { describe, it, expect } from 'vitest';
import {
  shouldOverwriteProvider,
  TTS_PROVIDER_OVERRIDES,
} from '@/lib/ttsPrecedence';
import type { TtsProvider } from '@/lib/languages';

/**
 * Locks the audio-regeneration precedence rules: which existing-provider audio
 * a newly-active provider should overwrite. Actively changed (Gemini just
 * landed), so a regression here would silently delete or strand user audio.
 */
const ALL_PROVIDERS: TtsProvider[] = ['google', 'elevenlabs', 'azure', 'gemini'];

describe('shouldOverwriteProvider', () => {
  it('never overwrites when current === existing', () => {
    for (const p of ALL_PROVIDERS) {
      expect(shouldOverwriteProvider(p, p)).toBe(false);
    }
  });

  it('google overwrites azure only', () => {
    expect(shouldOverwriteProvider('google', 'azure')).toBe(true);
    expect(shouldOverwriteProvider('google', 'elevenlabs')).toBe(false);
    expect(shouldOverwriteProvider('google', 'gemini')).toBe(false);
  });

  it('azure overwrites elevenlabs only', () => {
    expect(shouldOverwriteProvider('azure', 'elevenlabs')).toBe(true);
    expect(shouldOverwriteProvider('azure', 'google')).toBe(false);
    expect(shouldOverwriteProvider('azure', 'gemini')).toBe(false);
  });

  it('elevenlabs overwrites nothing', () => {
    for (const p of ALL_PROVIDERS) {
      expect(shouldOverwriteProvider('elevenlabs', p)).toBe(false);
    }
  });

  it('gemini overwrites every other provider', () => {
    expect(shouldOverwriteProvider('gemini', 'google')).toBe(true);
    expect(shouldOverwriteProvider('gemini', 'azure')).toBe(true);
    expect(shouldOverwriteProvider('gemini', 'elevenlabs')).toBe(true);
    expect(shouldOverwriteProvider('gemini', 'gemini')).toBe(false);
  });

  it('nothing overwrites gemini audio', () => {
    for (const p of ALL_PROVIDERS) {
      if (p === 'gemini') continue;
      expect(shouldOverwriteProvider(p, 'gemini')).toBe(false);
    }
  });
});

describe('TTS_PROVIDER_OVERRIDES', () => {
  it('has an entry for every TTS provider', () => {
    for (const p of ALL_PROVIDERS) {
      expect(TTS_PROVIDER_OVERRIDES[p], `missing override list for ${p}`).toBeDefined();
    }
  });

  it('never lists a provider as overriding itself', () => {
    for (const p of ALL_PROVIDERS) {
      expect(TTS_PROVIDER_OVERRIDES[p]).not.toContain(p);
    }
  });
});
