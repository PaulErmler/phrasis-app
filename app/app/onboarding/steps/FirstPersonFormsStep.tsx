'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  courseFirstPersonExample,
  languageMarksFirstPerson,
} from '@/lib/languageForms';
import type { FirstPersonForms } from '@/lib/preferenceResolution';
import { languageName } from '@/lib/languages';

/**
 * Wizard step "Which first-person forms do you want to learn?": the course's
 * `firstPersonForms` setting (lib/languageForms.ts). Single choice, phrased
 * as grammar (masculine / feminine forms, both alternating), never as the
 * learner's identity. The example block renders the first marked target
 * language's pair; a course whose languages mark nothing explains that the
 * choice sets the voice in every language, since one gender is spoken per
 * card whatever the grammar does.
 */

interface Props {
  targetLanguages: string[];
  baseLanguages: string[];
  selected: FirstPersonForms | null;
  onSelect: (choice: FirstPersonForms) => void;
}

export function FirstPersonFormsStep({
  targetLanguages,
  baseLanguages,
  selected,
  onSelect,
}: Props) {
  const t = useTranslations('Onboarding.firstPersonForms');
  const example = courseFirstPersonExample(targetLanguages, baseLanguages);
  const marked = [...targetLanguages, ...baseLanguages].some((code) =>
    languageMarksFirstPerson(code),
  );
  return (
    <div
      data-testid="onboarding-step-first-person-forms"
      className="h-full overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="min-h-full flex flex-col justify-center py-6">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">
            {example ? example.config.intro : t('voiceOnly')}
          </p>
        </div>
        <div className="space-y-2 max-w-md mx-auto w-full text-left">
          {(['masculine', 'feminine', 'both'] as const).map((choice) => (
            <ChoiceRow
              key={choice}
              testId={`first-person-forms-${choice}`}
              selected={selected === choice}
              onClick={() => onSelect(choice)}
              title={t(`options.${choice}.title`)}
              description={t(
                marked
                  ? `options.${choice}.description`
                  : `options.${choice}.voice`,
              )}
            />
          ))}
        </div>
        {example ? (
          <div
            className="max-w-md mx-auto w-full mt-5 rounded-xl border border-dashed bg-muted/50 px-4 py-3 text-sm"
            data-testid="first-person-forms-example"
          >
            <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground mb-1.5">
              {t('exampleLabel', { language: languageName(example.code) })}
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">
                {example.config.exampleEn}
              </span>
              <span className="text-right font-medium">
                {selected === 'feminine'
                  ? example.config.feminine
                  : selected === 'masculine'
                    ? example.config.masculine
                    : `${example.config.masculine} / ${example.config.feminine}`}
              </span>
            </div>
            {example.config.note ? (
              <div className="text-[11px] text-muted-foreground italic mt-1.5">
                {example.config.note}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ChoiceRow({
  selected,
  onClick,
  title,
  description,
  testId,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  testId: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'w-full rounded-xl border p-3 md:p-4 text-left transition-all flex items-start gap-3',
        'hover:bg-accent',
        selected && 'border-primary bg-primary/5 ring-2 ring-primary/20',
      )}
    >
      <span
        className={cn(
          'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2',
          selected ? 'border-primary bg-primary' : 'border-muted-foreground/40',
        )}
        aria-hidden
      />
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground mt-0.5">
          {description}
        </div>
      </div>
    </button>
  );
}
