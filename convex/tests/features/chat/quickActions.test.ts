import { describe, it, expect } from 'vitest';
import { ConvexError } from 'convex/values';
import {
  assertQuickActionWithinLimits,
  expandQuickAction,
  MAX_QUICK_ACTION_LANGUAGE_LENGTH,
  MAX_QUICK_ACTION_WORD_LENGTH,
  SENTENCE_QUICK_ACTION_KINDS,
  type QuickAction,
  type QuickActionContext,
} from '../../../features/chat/quickActions';
import { MAX_MESSAGE_LENGTH } from '../../../features/chat/constants';

const ctx: QuickActionContext = {
  card: {
    sourceText: 'Ich habe einen Hund.',
    sourceLanguage: 'de',
    translations: [{ language: 'en', text: 'I have a dog.' }],
  },
  baseLanguages: ['en'],
  targetLanguages: ['de'],
};

describe('features/chat/quickActions', () => {
  it('prefixes every expansion with the action kind header', () => {
    const actions: QuickAction[] = [
      { kind: 'grammar' },
      { kind: 'explainWord', word: 'Hund', language: 'de' },
      { kind: 'discussAnswer', userAnswer: 'x', expected: 'y', language: 'de' },
    ];
    for (const action of actions) {
      expect(expandQuickAction(action, ctx)).toMatch(
        new RegExp(`^\\[Quick action pressed by the user: ${action.kind}\\]`),
      );
    }
  });

  it('interpolates the target-language sentence for sentence actions', () => {
    for (const kind of SENTENCE_QUICK_ACTION_KINDS) {
      const out = expandQuickAction({ kind }, ctx);
      expect(out).toContain('"Ich habe einen Hund." (German)');
      expect(out).not.toContain('I have a dog');
    }
  });

  it('uses the target-language source text when the card source is the target', () => {
    const flipped: QuickActionContext = {
      card: {
        sourceText: 'I have a dog.',
        sourceLanguage: 'en',
        translations: [{ language: 'de', text: 'Ich habe einen Hund.' }],
      },
      baseLanguages: ['en'],
      targetLanguages: ['de'],
    };
    const out = expandQuickAction({ kind: 'grammar' }, flipped);
    expect(out).toContain('"Ich habe einen Hund." (German)');
    expect(out).not.toContain('"I have a dog."');
  });

  it('ends every expansion with a base-language reply instruction', () => {
    const actions: QuickAction[] = [
      { kind: 'grammar' },
      { kind: 'synonyms', word: 'Hund', language: 'de' },
      { kind: 'discussAnswer', userAnswer: 'x', expected: 'y', language: 'de' },
    ];
    for (const action of actions) {
      expect(expandQuickAction(action, ctx)).toContain(
        "Write your entire reply in English (the user's base language)",
      );
    }
    // No base language known → no reply note rather than a broken sentence.
    expect(
      expandQuickAction(
        { kind: 'grammar' },
        { card: null, baseLanguages: [], targetLanguages: ['de'] },
      ),
    ).not.toContain('Write your entire reply');
  });

  it('falls back to a target-language card-context reference without card data', () => {
    const out = expandQuickAction(
      { kind: 'tenses' },
      { card: null, baseLanguages: ['en'], targetLanguages: ['de'] },
    );
    expect(out).toContain('the German sentence currently being reviewed');
    expect(out).toContain('never its base-language translation');
  });

  it('names the target language as the analysis subject on sentence actions', () => {
    for (const kind of SENTENCE_QUICK_ACTION_KINDS) {
      const out = expandQuickAction({ kind }, ctx);
      expect(out).toContain(
        'Everything you analyze and every example you produce is German — the target language.',
      );
      expect(out).toContain(
        'Do not analyze or explain the base-language translation of this card.',
      );
    }
  });

  it('carries distinctive steering per sentence kind', () => {
    const markers: Record<string, string> = {
      grammar: 'detailed grammar explanation',
      conjugation: 'Do NOT recite conjugation tables',
      tenses: 'past and the future',
      paraphrase: 'paraphrases',
      formal: 'increasing formality',
      simpler: 'simpler versions',
    };
    for (const kind of SENTENCE_QUICK_ACTION_KINDS) {
      expect(expandQuickAction({ kind }, ctx)).toContain(markers[kind]);
    }
  });

  describe('word actions: base vs target branching', () => {
    it('explains a target-language word directly', () => {
      const out = expandQuickAction(
        { kind: 'explainWord', word: 'Hund', language: 'de' },
        ctx,
      );
      expect(out).toContain('German word "Hund"');
      expect(out).toContain('TARGET language');
      expect(out).toContain('DIFFERENT grammatical form');
      expect(out).not.toContain('Do NOT explain');
    });

    it('redirects a base-language word to its target-language equivalents', () => {
      const out = expandQuickAction(
        { kind: 'explainWord', word: 'dog', language: 'en' },
        ctx,
      );
      expect(out).toContain('BASE-language (English)');
      expect(out).toContain('Do NOT explain this base-language word');
      expect(out).toContain('translation(s)/equivalent(s) in German');
      expect(out).toContain('DIFFERENT grammatical forms');
    });

    it('keeps synonyms in the clicked word\'s own language', () => {
      const out = expandQuickAction(
        { kind: 'synonyms', word: 'Hund', language: 'de' },
        ctx,
      );
      expect(out).toContain('Give 3-6 synonyms in German');
      expect(out).toContain('not any other course language');
    });

    it('branches synonyms and antonyms the same way', () => {
      for (const kind of ['synonyms', 'antonyms'] as const) {
        const target = expandQuickAction({ kind, word: 'Hund', language: 'de' }, ctx);
        expect(target).toContain('"Hund"');
        expect(target).not.toContain('BASE-language');

        const base = expandQuickAction({ kind, word: 'dog', language: 'en' }, ctx);
        expect(base).toContain('BASE-language (English)');
        expect(base).toContain('give its equivalent(s) in German');
      }
      expect(
        expandQuickAction({ kind: 'antonyms', word: 'Hund', language: 'de' }, ctx),
      ).toContain('antonyms (opposites)');
    });
  });

  describe('multiple target languages', () => {
    const multi: QuickActionContext = {
      card: {
        sourceText: 'Hello, how are you?',
        sourceLanguage: 'en',
        translations: [
          { language: 'ro', text: 'Bună ziua, ce mai faci?' },
          { language: 'es', text: '¿Hola, cómo estás?' },
        ],
      },
      baseLanguages: ['en'],
      targetLanguages: ['ro', 'es'],
    };

    it('quotes every target sentence and asks for all of them', () => {
      const out = expandQuickAction({ kind: 'grammar' }, multi);
      expect(out).toContain('"Bună ziua, ce mai faci?" (Romanian)');
      expect(out).toContain('"¿Hola, cómo estás?" (Spanish (Spain))');
      expect(out).toContain(
        'in the target languages Romanian and Spanish (Spain)',
      );
      expect(out).toContain('Cover EACH of them in this reply');
      // Plural phrasing — no stray "the target language" singular.
      expect(out).not.toContain('— the target language.');
    });

    it('pluralizes the no-card fallback', () => {
      const out = expandQuickAction({ kind: 'tenses' }, { ...multi, card: null });
      expect(out).toContain(
        'the Romanian and Spanish (Spain) sentences currently being reviewed',
      );
      expect(out).toContain('never their base-language translation');
    });

    it('asks a base-language word for equivalents in every target language', () => {
      const out = expandQuickAction(
        { kind: 'explainWord', word: 'how', language: 'en' },
        multi,
      );
      expect(out).toContain(
        'covering EVERY target language (Romanian and Spanish (Spain)) separately',
      );
      expect(out).toContain('never only the first');
    });

    it('still scopes a target-word click to that word\'s language', () => {
      const out = expandQuickAction(
        { kind: 'synonyms', word: 'ziua', language: 'ro' },
        multi,
      );
      expect(out).toContain('Give 3-6 synonyms in Romanian');
      expect(out).not.toContain('Spanish');
    });

    it('names the primary base language when there are several', () => {
      const out = expandQuickAction(
        { kind: 'grammar' },
        { ...multi, baseLanguages: ['en', 'de'] },
      );
      expect(out).toContain("in English (the user's primary base language)");
    });
  });

  describe('assertQuickActionWithinLimits', () => {
    const tooLongCode = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        expect(e).toBeInstanceOf(ConvexError);
        return (e as ConvexError<{ code: string }>).data.code;
      }
      throw new Error('expected assertQuickActionWithinLimits to throw');
    };

    it('accepts payloads exactly at the limits', () => {
      expect(() =>
        assertQuickActionWithinLimits({
          kind: 'explainWord',
          word: 'w'.repeat(MAX_QUICK_ACTION_WORD_LENGTH),
          language: 'l'.repeat(MAX_QUICK_ACTION_LANGUAGE_LENGTH),
        }),
      ).not.toThrow();
      expect(() =>
        assertQuickActionWithinLimits({
          kind: 'discussAnswer',
          userAnswer: 'a'.repeat(MAX_MESSAGE_LENGTH),
          expected: 'e'.repeat(MAX_MESSAGE_LENGTH),
          language: 'de',
        }),
      ).not.toThrow();
      expect(() => assertQuickActionWithinLimits({ kind: 'grammar' })).not.toThrow();
    });

    it('throws MESSAGE_TOO_LONG for each over-long free-text field', () => {
      expect(
        tooLongCode(() =>
          assertQuickActionWithinLimits({
            kind: 'synonyms',
            word: 'w'.repeat(MAX_QUICK_ACTION_WORD_LENGTH + 1),
            language: 'de',
          }),
        ),
      ).toBe('MESSAGE_TOO_LONG');
      expect(
        tooLongCode(() =>
          assertQuickActionWithinLimits({
            kind: 'antonyms',
            word: 'Hund',
            language: 'l'.repeat(MAX_QUICK_ACTION_LANGUAGE_LENGTH + 1),
          }),
        ),
      ).toBe('MESSAGE_TOO_LONG');
      expect(
        tooLongCode(() =>
          assertQuickActionWithinLimits({
            kind: 'discussAnswer',
            userAnswer: 'a'.repeat(MAX_MESSAGE_LENGTH + 1),
            expected: 'ok',
            language: 'de',
          }),
        ),
      ).toBe('MESSAGE_TOO_LONG');
      expect(
        tooLongCode(() =>
          assertQuickActionWithinLimits({
            kind: 'discussAnswer',
            userAnswer: 'ok',
            expected: 'e'.repeat(MAX_MESSAGE_LENGTH + 1),
            language: 'de',
          }),
        ),
      ).toBe('MESSAGE_TOO_LONG');
    });
  });

  it('interpolates attempt, expected text, and language into discussAnswer', () => {
    const out = expandQuickAction(
      {
        kind: 'discussAnswer',
        userAnswer: 'Ich habe ein Hund.',
        expected: 'Ich habe einen Hund.',
        language: 'de',
      },
      ctx,
    );
    expect(out).toContain('expected German sentence');
    expect(out).toContain('"Ich habe einen Hund."');
    expect(out).toContain('The user wrote: "Ich habe ein Hund."');
    expect(out).toContain('ALSO a correct');
  });
});
