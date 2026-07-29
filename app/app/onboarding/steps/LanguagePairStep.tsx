'use client';

import { ArrowRight, Pencil } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { LanguageSelector } from '@/components/course/LanguageSelector';
import { Button } from '@/components/ui/button';
import { getLanguageByCode } from '@/lib/languages';

/**
 * Language pair step — sequential reveal.
 *
 * 1. Summary card at the top shows the current pair (placeholders if unset).
 * 2. Below it, a single `LanguageSelector` reveals — first the source, then
 *    the target. The user can "Change" either side after both are picked.
 *
 * Scroll containment: the outer step has `h-full overflow-hidden`. The
 * summary card is `shrink-0`. The picker container is `flex-1 min-h-0
 * overflow-hidden` so `LanguageSelector` (which has its own internal
 * `CommandList` scroll) handles its own overflow without bleeding to the
 * page.
 */
interface Props {
  source: string | null;
  target: string | null;
  onSource: (code: string) => void;
  onTarget: (code: string) => void;
}

export function LanguagePairStep({ source, target, onSource, onTarget }: Props) {
  const t = useTranslations('Onboarding.languagePair');
  const sourceLang = source ? getLanguageByCode(source) : null;
  const targetLang = target ? getLanguageByCode(target) : null;

  // Reveal order: pick source first; once source is set, pick target.
  // After both are set, no picker is shown — the parent's Continue button is
  // the next interaction.
  const showSourcePicker = !source;
  const showTargetPicker = !!source && !target;

  return (
    <div
      data-testid="onboarding-step-language-pair"
      className="flex flex-col h-full overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="shrink-0 py-3 px-1 md:py-4">
        <h2 className="text-xl md:text-2xl font-bold text-center">{t('title')}</h2>
        <p className="text-xs md:text-sm text-muted-foreground mt-1 text-center">
          {t('subtitle')}
        </p>
        <PairSummary
          source={sourceLang}
          target={targetLang}
          onChangeSource={() => onSource('')}
          onChangeTarget={() => onTarget('')}
          fromPlaceholder={t('fromPlaceholder')}
          toPlaceholder={t('toPlaceholder')}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {showSourcePicker ? (
          <PickerFrame title={t('iSpeak')}>
            <LanguageSelector
              selectedLanguages={[]}
              excludeLanguages={target ? [target] : []}
              onToggleLanguage={onSource}
            />
          </PickerFrame>
        ) : showTargetPicker ? (
          <PickerFrame title={t('iWantToLearn')}>
            <LanguageSelector
              selectedLanguages={[]}
              excludeLanguages={source ? [source] : []}
              onToggleLanguage={onTarget}
            />
          </PickerFrame>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center text-sm text-muted-foreground gap-2 px-4">
            <div>{t('readyTitle')}</div>
            <div className="text-xs">{t('readyHint')}</div>
          </div>
        )}
      </div>
    </div>
  );
}

function PairSummary({
  source,
  target,
  onChangeSource,
  onChangeTarget,
  fromPlaceholder,
  toPlaceholder,
}: {
  source: ReturnType<typeof getLanguageByCode> | null;
  target: ReturnType<typeof getLanguageByCode> | null;
  onChangeSource: () => void;
  onChangeTarget: () => void;
  fromPlaceholder: string;
  toPlaceholder: string;
}) {
  return (
    <div className="mt-3 flex items-center justify-center gap-2 md:gap-3">
      <SlotChip
        lang={source}
        placeholder={fromPlaceholder}
        onChange={onChangeSource}
        accentClass=""
      />
      <ArrowRight className="h-4 w-4 md:h-5 md:w-5 text-muted-foreground shrink-0" />
      <SlotChip
        lang={target}
        placeholder={toPlaceholder}
        onChange={onChangeTarget}
        accentClass="bg-primary text-primary-foreground hover:bg-primary/90"
      />
    </div>
  );
}

function SlotChip({
  lang,
  placeholder,
  onChange,
  accentClass,
}: {
  lang: ReturnType<typeof getLanguageByCode> | null;
  placeholder: string;
  onChange: () => void;
  accentClass: string;
}) {
  if (!lang) {
    return (
      <div className="inline-flex items-center rounded-full bg-muted text-muted-foreground px-3 py-1.5 text-xs md:text-sm italic">
        {placeholder}
      </div>
    );
  }
  return (
    <Button
      type="button"
      onClick={onChange}
      size="sm"
      className={`rounded-full gap-1.5 px-3 py-1.5 h-auto text-xs md:text-sm ${
        accentClass || 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
      }`}
    >
      <span className="text-base md:text-lg leading-none">{lang.flag}</span>
      <span className="font-medium truncate max-w-[10rem]">{lang.name}</span>
      <Pencil className="h-3 w-3 opacity-70 shrink-0" />
    </Button>
  );
}

function PickerFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="h-full flex flex-col overflow-hidden rounded-lg border bg-card">
      <div className="shrink-0 px-4 py-2 text-xs md:text-sm font-semibold text-muted-foreground border-b">
        {title}
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
    </div>
  );
}
