'use client';

import { useLocale } from 'next-intl';
import { Checkbox } from '@/components/ui/checkbox';
import {
  SUPPORTED_LANGUAGES,
  getLocalizedLanguageNameByCode,
} from '@/lib/languages';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface LanguageSelectorProps {
  title?: string;
  subtitle?: string;
  selectedLanguages: string[];
  excludeLanguages?: string[];
  onToggleLanguage: (languageCode: string) => void;
  multiSelect?: boolean;
}

export function LanguageSelector({
  title,
  subtitle,
  selectedLanguages,
  excludeLanguages = [],
  onToggleLanguage,
  multiSelect = false,
}: LanguageSelectorProps) {
  const locale = useLocale();

  // Filter out excluded languages
  const availableLanguages = SUPPORTED_LANGUAGES.filter(
    (lang) => !excludeLanguages.includes(lang.code),
  );

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      {title && (
        <div className="text-center space-y-2 py-4">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {subtitle && <p className="text-muted-sm">{subtitle}</p>}
        </div>
      )}

      <div className="flex-1 flex flex-col gap-3 overflow-y-auto py-3 pr-3">
        {availableLanguages.map((language) => {
          const isSelected = selectedLanguages.includes(language.code);
          return (
            <div
              key={language.code}
              role="button"
              tabIndex={0}
              onClick={() => onToggleLanguage(language.code)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onToggleLanguage(language.code);
                }
              }}
              className={cn(
                buttonVariants({ variant: 'ghost' }),
                'h-auto flex items-center justify-start gap-3 p-3 rounded-xl border-2 transition-all text-left cursor-pointer',
                isSelected
                  ? 'border-primary bg-primary/5 shadow-sm hover:bg-primary/5'
                  : 'border-muted hover:border-muted-foreground/30 hover:bg-muted/50',
              )}
            >
              <span className="text-2xl shrink-0">{language.flag}</span>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm leading-tight break-words">
                  {getLocalizedLanguageNameByCode(language.code, locale)}
                </p>
                <p className="text-muted-xs break-words">
                  {language.nativeName}
                </p>
              </div>
              <Checkbox checked={isSelected} className="pointer-events-none" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
