'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';
import {
  SUPPORTED_LANGUAGES,
  getLocalizedLanguageNameByCode,
  type Language,
  type LanguageCategory,
} from '@/lib/languages';
import { cn } from '@/lib/utils';

interface LanguageSelectorProps {
  title?: string;
  subtitle?: string;
  selectedLanguages: string[];
  excludeLanguages?: string[];
  onToggleLanguage: (languageCode: string) => void;
}

// Fixed display order — categories listed top-down in the picker. The
// LanguageSelector.categories.* i18n keys map to these slugs.
const CATEGORY_ORDER = [
  'germanic',
  'romance',
  'slavic',
  'asian-east',
  'asian-southeast',
  'semitic',
  'african',
  'other',
] as const satisfies readonly LanguageCategory[];

// Compile-time exhaustiveness: if a new value is added to LanguageCategory,
// this line errors until CATEGORY_ORDER is updated to include it.
type _CategoryOrderIsExhaustive =
  Exclude<LanguageCategory, (typeof CATEGORY_ORDER)[number]> extends never
    ? true
    : never;
const _categoryOrderExhaustive: _CategoryOrderIsExhaustive = true;
void _categoryOrderExhaustive;

// Module-level singleton so `excludeLanguages = EMPTY_EXCLUDE` keeps a stable
// reference when callers omit the prop — otherwise the inline `= []` default
// would allocate a fresh array each render and invalidate the useMemo below.
const EMPTY_EXCLUDE: string[] = [];

export function LanguageSelector({
  title,
  subtitle,
  selectedLanguages,
  excludeLanguages = EMPTY_EXCLUDE,
  onToggleLanguage,
}: LanguageSelectorProps) {
  const locale = useLocale();
  const t = useTranslations('LanguageSelector');

  const availableLanguages = useMemo(
    () =>
      SUPPORTED_LANGUAGES.filter((lang) => !excludeLanguages.includes(lang.code)),
    [excludeLanguages],
  );

  // Group by category. Within each group, sort alphabetically by the locale-
  // aware display name so the order matches what the user sees.
  const grouped = useMemo(() => {
    const buckets = new Map<LanguageCategory, Language[]>();
    for (const lang of availableLanguages) {
      const cat = lang.category;
      const list = buckets.get(cat) ?? [];
      list.push(lang);
      buckets.set(cat, list);
    }
    const out: { category: LanguageCategory; languages: Language[] }[] = [];
    for (const cat of CATEGORY_ORDER) {
      const list = buckets.get(cat);
      if (!list || list.length === 0) continue;
      const sorted = [...list].sort((a, b) =>
        getLocalizedLanguageNameByCode(a.code, locale).localeCompare(
          getLocalizedLanguageNameByCode(b.code, locale),
          locale,
        ),
      );
      out.push({ category: cat, languages: sorted });
    }
    return out;
  }, [availableLanguages, locale]);

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      {title && (
        <div className="text-center space-y-2 py-4">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-muted-sm">{subtitle}</p>}
        </div>
      )}

      <Command
        // cmdk runs case-insensitive substring filtering on each item's `value`
        // — we build a composite value below so the English name, native name,
        // and the user-locale display name all match the search input.
        className="flex-1 bg-transparent overflow-hidden"
        filter={(value, search) =>
          value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
        }
      >
        <CommandInput
          placeholder={t('searchPlaceholder')}
          aria-label={t('searchPlaceholder')}
        />
        <CommandList className="max-h-full flex-1">
          <CommandEmpty>{t('noResults')}</CommandEmpty>
          {grouped.map(({ category, languages }) => (
            <CommandGroup key={category} heading={t(`categories.${category}`)}>
              {languages.map((language) => {
                const isSelected = selectedLanguages.includes(language.code);
                const localizedName = getLocalizedLanguageNameByCode(
                  language.code,
                  locale,
                );
                // Searchable haystack: English name + native name +
                // user-locale name + internal code, all joined so cmdk's
                // substring filter hits any of them.
                const haystack = [
                  language.name,
                  language.nativeName,
                  localizedName,
                  language.code,
                ]
                  .filter(Boolean)
                  .join(' • ');
                return (
                  <CommandItem
                    key={language.code}
                    value={haystack}
                    onSelect={() => onToggleLanguage(language.code)}
                    className={cn(
                      'flex items-center gap-3 p-3 my-1 rounded-xl border-2 transition-all cursor-pointer',
                      isSelected
                        ? 'border-primary bg-primary/5 shadow-sm'
                        : 'border-muted hover:border-muted-foreground/30 hover:bg-muted/50',
                    )}
                  >
                    <span className="text-2xl shrink-0">{language.flag}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-semibold text-sm leading-tight break-words">
                          {localizedName}
                        </p>
                        {language.llmSupportTier === 'tier2' && (
                          <span
                            className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                            title={t('tierBadgeTooltip')}
                          >
                            {t('tierBadge')}
                          </span>
                        )}
                      </div>
                      <p className="text-muted-xs break-words">
                        {language.nativeName}
                      </p>
                    </div>
                    <Checkbox
                      checked={isSelected}
                      className="pointer-events-none"
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </div>
  );
}
