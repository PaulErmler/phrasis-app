import { describe, expect, it } from 'vitest';
import {
  LLM_ROMANIZATION_LANGUAGES,
  getRomanizationSource,
} from '../../lib/localRomanization';
import {
  buildRomanizationSystemPrompt,
  getRomanizationConvention,
  parseRomanization,
} from '../../lib/romanizationPrompt';

describe('model-routed romanization: every language is fully wired', () => {
  // Adding `romanizationBackend: 'llm'` to a language compiles on its own.
  // Without a convention the action would throw on every row of that
  // language, and without a source tag the probe could not tell a current
  // row from a stale one.
  const codes = [...LLM_ROMANIZATION_LANGUAGES];

  it('routes at least Thai and Hebrew here', () => {
    expect(codes).toEqual(expect.arrayContaining(['th', 'he']));
  });

  it('has a convention and a system prompt for each', () => {
    for (const code of codes) {
      expect(getRomanizationConvention(code), code).not.toBeNull();
      expect(buildRomanizationSystemPrompt(code), code).toContain('RULES');
    }
  });

  it('has a distinct per-language source tag for each', () => {
    const tags = codes.map((code) => getRomanizationSource(code));
    codes.forEach((code, i) => expect(tags[i], code).toContain(`-${code}-`));
    expect(new Set(tags).size).toBe(tags.length);
  });

  it('rejects a language nothing is configured for', () => {
    expect(getRomanizationConvention('pl')).toBeNull();
    expect(() => buildRomanizationSystemPrompt('pl')).toThrow(/convention/);
  });
});

describe('parseRomanization', () => {
  it('reads the JSON object the prompt asks for, trimmed', () => {
    expect(parseRomanization('{"romanization": " sawatdi khrap "}')).toBe(
      'sawatdi khrap',
    );
  });

  it('tolerates a markdown fence around it', () => {
    expect(parseRomanization('```json\n{"romanization":"shalom"}\n```')).toBe(
      'shalom',
    );
  });

  it('returns null for anything else', () => {
    for (const raw of [
      '',
      'shalom',
      '{"romanization": ""}',
      '{"romanization": 3}',
      '[]',
      'null',
    ]) {
      expect(parseRomanization(raw), raw).toBeNull();
    }
  });
});
