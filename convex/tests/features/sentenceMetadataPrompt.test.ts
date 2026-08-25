import { describe, it, expect } from 'vitest';

import {
  buildMetadataSystemPrompt,
  buildAutofillSpeakerGenderRule,
  buildMetadataUserPrompt,
  partitionMarkedLanguages,
} from '../../features/sentenceMetadataPrompt';
import { getSpeakerGenderMarking } from '../../../lib/languages';

/**
 * Per-request prompt assembly (speaker-gender spec, decision 8): the
 * speakerGender instruction names exactly the marked subset of THIS request's
 * languages, driven solely by `speakerGenderMarking` in the language config —
 * a config change changes the prompt, and no global language list exists.
 */

describe('partitionMarkedLanguages', () => {
  it('splits by config tier and drops unmarked languages', () => {
    expect(partitionMarkedLanguages(['en', 'es', 'ja', 'de', 'ru'])).toEqual({
      grammatical: ['Spanish (Spain)', 'Russian'],
      stylistic: ['Japanese'],
    });
  });

  it('deduplicates display names shared by dialect variants', () => {
    const { grammatical } = partitionMarkedLanguages(['es', 'es']);
    expect(grammatical).toEqual(['Spanish (Spain)']);
  });

  it('is driven by the config, not a hardcoded list', () => {
    // Every language the partition returns is marked in the config, and every
    // marked language in the request is returned — the function is a pure
    // view of `getSpeakerGenderMarking`.
    const request = ['en', 'es', 'th', 'zh', 'he', 'ko', 'tr'];
    const { grammatical, stylistic } = partitionMarkedLanguages(request);
    const marked = request.filter(
      (code) => getSpeakerGenderMarking(code) !== 'none',
    );
    expect(grammatical.length + stylistic.length).toBe(marked.length);
  });
});

describe('buildMetadataSystemPrompt', () => {
  it('names exactly the marked subset of the request', () => {
    const prompt = buildMetadataSystemPrompt(['en', 'es', 'ru', 'de']);
    expect(prompt).toContain('Spanish (Spain) and Russian mark it grammatically');
    // Unmarked request languages are never named in the speakerGender rule.
    const rule = prompt
      .split('- speakerGender:')[1]
      .split('- addresseeGender:')[0];
    expect(rule).not.toContain('English');
    // The German lexical example is a fixed illustration, not a request
    // language mention.
    expect(rule).toContain('Ich bin Lehrerin');
  });

  it('names stylistic languages with stylistic guidance', () => {
    const prompt = buildMetadataSystemPrompt(['en', 'th']);
    expect(prompt).toContain('Thai marks it stylistically');
    expect(prompt).toContain('polite particles');
    expect(prompt).not.toContain('mark it grammatically');
  });

  it('reduces to "return neutral" when no request language is marked', () => {
    const prompt = buildMetadataSystemPrompt(['en', 'de', 'zh']);
    expect(prompt).toContain(
      'None of the languages in this request mark the speaker',
    );
    // The lexical escape hatch stays open (uploads with explicit
    // self-descriptions must still pin, decision 6 / gold controls).
    expect(prompt).toContain('lexical self-description');
    expect(prompt).not.toContain('mark it grammatically');
  });

  it('never embeds a global marked-language list (absent languages unnamed)', () => {
    const prompt = buildMetadataSystemPrompt(['en', 'es']);
    const rule = prompt
      .split('- speakerGender:')[1]
      .split('- addresseeGender:')[0];
    // Marked languages NOT in the request must not appear in the rule.
    for (const name of ['Russian', 'Hebrew', 'Thai', 'Polish', 'Hindi']) {
      expect(rule).not.toContain(name);
    }
  });

  it('keeps the static envelope (JSON contract, other fields) intact', () => {
    const prompt = buildMetadataSystemPrompt(['en', 'es']);
    expect(prompt).toContain('EXACTLY these five keys');
    expect(prompt).toContain('- register:');
    expect(prompt).toContain('- addresseeNumber:');
    expect(prompt).toContain('- addresseeGender:');
    expect(prompt).toContain('- addressesSomeone:');
  });
});

describe('buildAutofillSpeakerGenderRule', () => {
  it('names the marked subset for a mixed request', () => {
    const rule = buildAutofillSpeakerGenderRule(['en', 'pt', 'ja', 'de']);
    expect(rule).toContain('Portuguese (Brazil) and Japanese mark the speaker');
    expect(rule).toContain('self-reference pronouns');
    expect(rule).not.toContain('English');
  });

  it('reduces to neutral-only when nothing is marked', () => {
    const rule = buildAutofillSpeakerGenderRule(['en', 'de']);
    expect(rule).toContain(
      "none of this request's languages mark the speaker",
    );
  });
});

describe('buildMetadataUserPrompt', () => {
  it('labels renderings with display names and keeps order', () => {
    const prompt = buildMetadataUserPrompt([
      { language: 'es', text: 'Estoy cansada.' },
      { language: 'en', text: 'I am tired.' },
    ]);
    expect(prompt).toContain('[Spanish (Spain)]: Estoy cansada.');
    expect(prompt).toContain('[English]: I am tired.');
    expect(prompt.indexOf('[Spanish (Spain)]')).toBeLessThan(
      prompt.indexOf('[English]'),
    );
  });
});
