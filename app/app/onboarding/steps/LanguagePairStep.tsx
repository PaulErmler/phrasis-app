'use client';

import { useMemo, useState } from 'react';
import { ArrowLeftRight, ChevronLeft, Pencil, Search } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Input } from '@/components/ui/input';
import {
  SUPPORTED_LANGUAGES,
  getLanguageByCode,
  getLocalizedLanguageNameByCode,
  type Language,
  type LanguageCategory,
} from '@/lib/languages';
import { cn } from '@/lib/utils';

/**
 * Language pair step. Variant A.
 *
 * One big question at a time (learn → speak), then a ready confirmation with
 * swap. Target is asked first because that’s the question users usually have
 * in mind; base language second, with an in-step back to change the target.
 * All pickable languages are always in the scrollable grid (search filters;
 * no “browse all” toggle). Names wrap so long labels stay fully visible.
 *
 * Scroll containment: outer `h-full overflow-hidden`; header `shrink-0`;
 * grid `flex-1 min-h-0 overflow-y-auto`.
 */
interface Props {
  source: string | null;
  target: string | null;
  onSource: (code: string) => void;
  onTarget: (code: string) => void;
}

const CATEGORY_ORDER = [
  'germanic',
  'romance',
  'slavic',
  'baltic',
  'asian-east',
  'asian-southeast',
  'south-asian',
  'semitic',
  'african',
  'other',
] as const satisfies readonly LanguageCategory[];

/** Pinned at the top; still listed again in their category sections below. */
const POPULAR_CODES = [
  'es',
  'fr',
  'ar',
  'zh',
  'ja',
  'hi',
  'de',
  'en',
] as const;

const PICKABLE = SUPPORTED_LANGUAGES.filter((l) => !l.hiddenFromPicker);

export function LanguagePairStep({ source, target, onSource, onTarget }: Props) {
  const t = useTranslations('Onboarding.languagePair');
  const tLang = useTranslations('LanguageSelector');
  const locale = useLocale();
  const [query, setQuery] = useState('');

  // Target (learn) first, then source (already speak), then ready.
  const phase: 'target' | 'source' | 'ready' = !target
    ? 'target'
    : !source
      ? 'source'
      : 'ready';

  const exclude = phase === 'target' ? source : target;

  const { popular, grouped } = useMemo(() => {
    const available = PICKABLE.filter((l) => l.code !== exclude);
    const q = query.trim().toLowerCase();
    const matchesQuery = (l: Language) => {
      if (!q) return true;
      const localized = getLocalizedLanguageNameByCode(l.code, locale);
      return (
        l.name.toLowerCase().includes(q) ||
        l.nativeName.toLowerCase().includes(q) ||
        localized.toLowerCase().includes(q) ||
        l.code.toLowerCase().includes(q)
      );
    };
    const filtered = available.filter(matchesQuery);
    const byCode = new Map(filtered.map((l) => [l.code, l]));

    const popularLangs = POPULAR_CODES.map((code) => byCode.get(code)).filter(
      (l): l is Language => !!l,
    );

    const buckets = new Map<LanguageCategory, Language[]>();
    for (const lang of filtered) {
      const list = buckets.get(lang.category) ?? [];
      list.push(lang);
      buckets.set(lang.category, list);
    }

    const groups: { category: LanguageCategory; languages: Language[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const list = buckets.get(cat);
      if (!list || list.length === 0) continue;
      const sorted = [...list].sort((a, b) =>
        getLocalizedLanguageNameByCode(a.code, locale).localeCompare(
          getLocalizedLanguageNameByCode(b.code, locale),
          locale,
        ),
      );
      groups.push({ category: cat, languages: sorted });
    }
    return { popular: popularLangs, grouped: groups };
  }, [exclude, query, locale]);

  const pick = (code: string) => {
    if (phase === 'target') {
      onTarget(code);
      setQuery('');
    } else if (phase === 'source') {
      onSource(code);
      setQuery('');
    }
  };

  const backToTarget = () => {
    onTarget('');
    setQuery('');
  };

  const sourceLang = source ? getLanguageByCode(source) : null;
  const targetLang = target ? getLanguageByCode(target) : null;

  const swap = () => {
    if (!source || !target) return;
    onSource(target);
    onTarget(source);
  };

  return (
    <div
      data-testid="onboarding-step-language-pair"
      className="flex h-full flex-col overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-1 pb-2 pt-3 md:pt-4">
        <div className="mb-4 shrink-0 space-y-2">
          {phase === 'ready' ? (
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('stepReady')}
            </p>
          ) : null}
          <h2 className="text-2xl font-bold tracking-tight sm:text-[1.7rem] sm:leading-tight">
            {phase === 'target' && t('learnTitle')}
            {phase === 'source' && t('speakTitle')}
            {phase === 'ready' && t('readyTitle')}
          </h2>
          {phase === 'target' && (
            <p className="text-base text-muted-foreground">{t('learnHint')}</p>
          )}
          {phase === 'source' && (
            <p className="text-base text-muted-foreground">{t('speakHint')}</p>
          )}
          {phase === 'source' && targetLang ? (
            <button
              type="button"
              onClick={backToTarget}
              data-testid="language-pair-back"
              className="inline-flex items-center gap-1.5 pt-0.5 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
              {t('backToLearn', {
                language: getLocalizedLanguageNameByCode(targetLang.code, locale),
              })}
            </button>
          ) : null}
        </div>

        {phase !== 'ready' ? (
          <>
            <div className="mb-3 shrink-0">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tLang('searchPlaceholder')}
                  aria-label={tLang('searchPlaceholder')}
                  className="h-11 pl-9 text-base"
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
              {grouped.length === 0 && popular.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {tLang('noResults')}
                </p>
              ) : (
                <div className="space-y-4">
                  {popular.length > 0 ? (
                    <section>
                      <h3 className="mb-2 px-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {t('popular')}
                      </h3>
                      <div className="grid grid-cols-2 gap-2">
                        {popular.map((lang) => (
                          <LanguageTile
                            key={`popular-${lang.code}`}
                            lang={lang}
                            locale={locale}
                            onPick={pick}
                          />
                        ))}
                      </div>
                    </section>
                  ) : null}
                  {grouped.map(({ category, languages }) => (
                    <section key={category}>
                      <h3 className="mb-2 px-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {tLang(`categories.${category}`)}
                      </h3>
                      <div className="grid grid-cols-2 gap-2">
                        {languages.map((lang) => (
                          <LanguageTile
                            key={lang.code}
                            lang={lang}
                            locale={locale}
                            onPick={pick}
                          />
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4 px-1">
            <div className="flex w-full flex-col gap-2">
              <ReadyChip
                lang={sourceLang}
                role={t('speakRole')}
                locale={locale}
                onEdit={() => onSource('')}
              />
              <div className="flex justify-center">
                <button
                  type="button"
                  onClick={swap}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
                  aria-label={t('swap')}
                >
                  <ArrowLeftRight className="h-3.5 w-3.5" />
                  {t('swap')}
                </button>
              </div>
              <ReadyChip
                lang={targetLang}
                role={t('learnRole')}
                locale={locale}
                accent
                onEdit={() => onTarget('')}
              />
            </div>
            <p className="text-center text-base text-muted-foreground">
              {t('readyHint')}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function LanguageTile({
  lang,
  locale,
  onPick,
}: {
  lang: Language;
  locale: string;
  onPick: (code: string) => void;
}) {
  const localized = getLocalizedLanguageNameByCode(lang.code, locale);
  return (
    <button
      type="button"
      onClick={() => onPick(lang.code)}
      data-testid={`language-option-${lang.code}`}
      className="flex items-start gap-2 rounded-xl border bg-card px-2.5 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/5 active:scale-[0.98]"
    >
      <span className="shrink-0 text-2xl leading-none" aria-hidden>
        {lang.flag}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold leading-snug break-words">
          {localized}
        </span>
        {lang.nativeName.toLowerCase() !== localized.toLowerCase() ? (
          <span className="mt-0.5 block text-xs leading-snug text-muted-foreground break-words">
            {lang.nativeName}
          </span>
        ) : null}
      </span>
    </button>
  );
}

function ReadyChip({
  lang,
  role,
  locale,
  accent,
  onEdit,
}: {
  lang: Language | null | undefined;
  role: string;
  locale: string;
  accent?: boolean;
  onEdit: () => void;
}) {
  if (!lang) return null;
  const name = getLocalizedLanguageNameByCode(lang.code, locale);
  return (
    <button
      type="button"
      onClick={onEdit}
      className={cn(
        'flex w-full flex-col items-start gap-1 rounded-2xl border px-4 py-3.5 text-left',
        accent
          ? 'border-primary/40 bg-primary text-primary-foreground'
          : 'bg-secondary text-secondary-foreground',
      )}
    >
      <span
        className={cn(
          'text-xs font-medium uppercase tracking-wide',
          accent ? 'text-primary-foreground/80' : 'text-muted-foreground',
        )}
      >
        {role}
      </span>
      <span className="flex w-full items-start gap-3">
        <span className="shrink-0 text-3xl leading-none" aria-hidden>
          {lang.flag}
        </span>
        <span className="min-w-0 flex-1 whitespace-normal break-words text-xl font-bold leading-snug">
          {name}
        </span>
        <Pencil className="mt-1 h-4 w-4 shrink-0 opacity-70" />
      </span>
    </button>
  );
}
