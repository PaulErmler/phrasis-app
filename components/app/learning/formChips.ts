import {
  distinctPolitenessForms,
  politenessFormForLevel,
  type PolitenessLevel,
} from '@/lib/languageForms';
import { getLanguageShortLabel } from '@/lib/languages';

/** One chip in the card header: what the served wording is on one axis. */
export interface FormChip {
  label: string;
  /** Longer name for the title attribute (the language's own form). */
  title?: string;
  testId: string;
}

type ChipTranslation = {
  language: string;
  isTargetLanguage: boolean;
  renderedGender?: 'masculine' | 'feminine';
  renderedPoliteness?: PolitenessLevel;
};

/**
 * The sentence-form chips for a card (docs/architecture/translation-
 * variants.md): the gender once, since it is one per card, and the
 * politeness form per target language, prefixed with the language when two
 * targets disagree. A pre-feature card shows what its row IS (from the
 * classifier backfill), not the course setting; an unmarked or unstamped
 * row shows nothing.
 */
export function buildFormChips(
  translations: ChipTranslation[],
  t: (key: 'masculine' | 'feminine' | 'casual' | 'polite' | 'formal') => string,
): FormChip[] {
  const targets = translations.filter((tr) => tr.isTargetLanguage);
  const chips: FormChip[] = [];
  const gender = targets.find((tr) => tr.renderedGender)?.renderedGender;
  if (gender) {
    chips.push({ label: t(gender), testId: `form-chip-${gender}` });
  }
  const polite = targets.filter((tr) => tr.renderedPoliteness);
  const disagree =
    new Set(polite.map((tr) => `${tr.renderedPoliteness}`)).size > 1;
  for (const tr of polite) {
    const level = tr.renderedPoliteness!;
    const form = politenessFormForLevel(tr.language, level);
    // Three-form languages read the global word; a two-form language names
    // its own form (du-form, vous), where "polite" would be ambiguous.
    const own =
      form && distinctPolitenessForms(tr.language).length < 3
        ? ownFormName(form.label)
        : undefined;
    const base = own ?? t(level);
    chips.push({
      label: disagree ? `${getLanguageShortLabel(tr.language)} ${base}` : base,
      title: form?.label,
      testId: `form-chip-${tr.language}-${level}`,
    });
  }
  return chips;
}

/** "du-form · everyday" -> "du-form", "Polite · vous" -> "vous". */
function ownFormName(label: string): string {
  const parts = label.split(' · ');
  const global = new Set(['Casual', 'Polite', 'Formal']);
  return parts.find((part) => !global.has(part)) ?? parts[0];
}
