import { describe, expect, it } from 'vitest';
import {
  axisOf,
  parseRenderingKey,
  renderingKey,
  resolveCardRendering,
  textRenderingKey,
  voiceOf,
  type RenderingText,
} from '@/lib/preferenceResolution';
import { resolveCardSpeakerGenders } from '@/lib/voices';

const premade: RenderingText = { userCreated: false };
const textId = 'k17abcdef0123456789';

/** The text's own (seeded) voice for `premade`. */
const textVoice = resolveCardSpeakerGenders(premade, textId).audioSpeakerGender;

describe('keys', () => {
  it('map a gender axis onto its voice and back', () => {
    expect(voiceOf('masculine')).toBe('male');
    expect(voiceOf('feminine')).toBe('female');
    expect(axisOf('male')).toBe('masculine');
    expect(axisOf('female')).toBe('feminine');
  });

  it('build and parse a rendering key', () => {
    expect(renderingKey('female')).toBe('female');
    expect(parseRenderingKey('female')).toEqual({ voice: 'female' });
    expect(parseRenderingKey('male')).toEqual({ voice: 'male' });
  });
});

describe('resolveCardRendering', () => {
  it('the voice is the text’s own, decided once and kept', () => {
    expect(resolveCardRendering({ text: premade, textId }).voiceGender).toBe(
      textVoice,
    );
    expect(textRenderingKey({ text: premade, textId })).toBe(textVoice);
  });

  it('a stored voice wins over the seeded flip', () => {
    const text: RenderingText = {
      userCreated: false,
      audioSpeakerGender: 'female',
    };
    expect(resolveCardRendering({ text, textId }).voiceGender).toBe('female');
    expect(textRenderingKey({ text, textId })).toBe('female');
  });

  it('a definitive speaker gender at the current source decides the voice', () => {
    const text: RenderingText = {
      userCreated: false,
      speakerGender: 'male',
      audioSpeakerGender: 'male',
      metadataSource: 'gemini-3.1-flash-lite-v1',
    };
    expect(resolveCardRendering({ text, textId }).voiceGender).toBe('male');
  });

  it('a user-written text keeps the voice it was stored with', () => {
    const text: RenderingText = {
      userCreated: true,
      audioSpeakerGender: 'male',
    };
    expect(resolveCardRendering({ text, textId }).voiceGender).toBe('male');
  });
});
