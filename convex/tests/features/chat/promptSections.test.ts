import { describe, it, expect } from 'vitest';
import {
  buildCardContextSection,
  buildLanguageSection,
} from '../../../features/chat/promptSections';

describe('features/chat/promptSections', () => {
  describe('buildLanguageSection', () => {
    const section = buildLanguageSection({
      baseLanguages: ['en'],
      targetLanguages: ['es', 'fr'],
    });

    it('groups base and target languages under labeled headings', () => {
      const baseIdx = section.indexOf('BASE languages');
      const targetIdx = section.indexOf('TARGET languages');
      expect(baseIdx).toBeGreaterThan(-1);
      expect(targetIdx).toBeGreaterThan(baseIdx);
      // en listed under BASE, es/fr under TARGET
      expect(section.slice(baseIdx, targetIdx)).toContain('- en: English');
      expect(section.slice(targetIdx)).toContain('- es: Spanish');
      expect(section.slice(targetIdx)).toContain('- fr: French');
    });

    it('states the target-language explanation rule and names the targets', () => {
      expect(section).toContain(
        'Explanations are always ABOUT the TARGET language(s) — Spanish (Spain) and French',
      );
    });

    it('binds "this sentence" to the target-language text', () => {
      expect(section).toContain(
        '"This sentence" / "this word" / "this card" ALWAYS refers to the target-language text',
      );
      expect(section).toContain('Never analyze base-language grammar');
    });

    it('states the base-language reply rule with the base language named', () => {
      expect(section).toContain(
        'Write your replies IN the BASE language (English)',
      );
    });

    it('keeps createCard order base-first-then-target with per-code text rules', () => {
      expect(section).toContain(
        'createCard order (one entry per code, exactly this order): en, es, fr',
      );
      expect(section).toContain('the "en" text must be English');
      expect(section).toContain('the "es" text must be Spanish (Spain)');
      expect(section).toContain(
        'Schematic: [{"language":"en","text":"<English sentence>"},{"language":"es","text":"<Spanish (Spain) sentence>"},{"language":"fr","text":"<French sentence>"}]',
      );
    });

    it('tells the tutor to cover every target language when there are several', () => {
      expect(section).toContain('cover EVERY target language');
      expect(section).toContain(
        'each target language (Spanish (Spain) and French)',
      );
      expect(section).toContain('are in the target languages');
    });

    it('keeps singular phrasing for a single-target course', () => {
      const s = buildLanguageSection({
        baseLanguages: ['en'],
        targetLanguages: ['de'],
      });
      expect(s).not.toContain('cover EVERY target language');
      expect(s).toContain('are in the target language.');
    });

    it('names the primary base language when there are several', () => {
      const s = buildLanguageSection({
        baseLanguages: ['en', 'de'],
        targetLanguages: ['es'],
      });
      expect(s).toContain('Write your replies IN the PRIMARY BASE language (English)');
    });

    it('dedupes codes shared between base and target', () => {
      const s = buildLanguageSection({
        baseLanguages: ['en', 'en'],
        targetLanguages: ['en', 'de'],
      });
      expect(s).toContain('exactly this order): en, de');
      expect(s.match(/"language":"en"/g)).toHaveLength(1);
    });
  });

  describe('buildCardContextSection', () => {
    it('labels each line with the language role', () => {
      const section = buildCardContextSection({
        sourceText: 'Hallo, wie geht es dir?',
        sourceLanguage: 'de',
        translations: [{ language: 'en', text: 'Hello, how are you?' }],
        baseLanguages: ['en'],
        targetLanguages: ['de'],
      });
      expect(section).toContain('The user is currently reviewing this card:');
      expect(section).toContain('Original (de — TARGET): "Hallo, wie geht es dir?"');
      expect(section).toContain('en — BASE: "Hello, how are you?"');
    });

    it('spells out that "this sentence" means the target-language text', () => {
      const section = buildCardContextSection({
        sourceText: 'Hello, how are you?',
        sourceLanguage: 'en',
        translations: [{ language: 'de', text: 'Hallo, wie geht es dir?' }],
        baseLanguages: ['en'],
        targetLanguages: ['de'],
      });
      expect(section).toContain(
        'they ALWAYS mean the TARGET-language text: "Hallo, wie geht es dir?" (German)',
      );
      expect(section).toContain('never the base-language rendering');
    });

    it('pluralizes the subject rule for several target languages', () => {
      const section = buildCardContextSection({
        sourceText: 'Hello, how are you?',
        sourceLanguage: 'en',
        translations: [
          { language: 'ro', text: 'Bună ziua, ce mai faci?' },
          { language: 'es', text: '¿Hola, cómo estás?' },
        ],
        baseLanguages: ['en'],
        targetLanguages: ['ro', 'es'],
      });
      expect(section).toContain('they ALWAYS mean the TARGET-language texts:');
      expect(section).toContain('"Bună ziua, ce mai faci?" (Romanian)');
      expect(section).toContain('"¿Hola, cómo estás?" (Spanish (Spain))');
      expect(section).toContain('cover every target language');
    });
  });
});
