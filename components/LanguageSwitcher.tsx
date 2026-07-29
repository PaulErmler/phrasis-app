'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useState, useTransition } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { setUserLocale } from '@/i18n/locale';
import { CLIENT_EVENTS, capture } from '@/lib/posthog/events';
import { cn } from '@/lib/utils';

const locales = [
  { code: 'en', label: 'English', flag: '🇬🇧' },
  { code: 'de', label: 'Deutsch', flag: '🇩🇪' },
] as const;

interface LanguageSwitcherProps {
  /** Show only the flag icon (compact mode for headers) */
  compact?: boolean;
  /** Additional classes for the trigger */
  className?: string;
}

export function LanguageSwitcher({
  compact = false,
  className,
}: LanguageSwitcherProps) {
  const locale = useLocale();
  const t = useTranslations('Language');
  const [mounted, setMounted] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleLocaleChange = (newLocale: string) => {
    capture(CLIENT_EVENTS.LOCALE_CHANGED, { from: locale, to: newLocale });
    startTransition(() => {
      setUserLocale(newLocale as 'en' | 'de');
    });
  };

  const currentLocale = locales.find((l) => l.code === locale);

  // Defer Radix (DropdownMenu / Select) until after mount to avoid hydration mismatch
  if (!mounted) {
    if (compact) {
      return (
        <div
          className={cn(
            'inline-flex items-center justify-center size-9 rounded-md',
            className,
          )}
          aria-hidden
        >
          <span className="text-base">{currentLocale?.flag}</span>
          <span className="sr-only">{t('title')}</span>
        </div>
      );
    }
    return (
      <div
        className={cn(
          'flex h-9 w-full items-center justify-between rounded-md border border-input bg-transparent px-3 py-2 text-sm',
          className,
        )}
        aria-hidden
      >
        <span>{currentLocale?.flag}</span>
        <span>{currentLocale?.label}</span>
      </div>
    );
  }

  // Compact mode - use DropdownMenu like ThemeSwitcher
  if (compact) {
    return (
      // `modal={false}` — see ThemeSwitcher for the same reasoning. Default
      // modal=true locks body scroll and shifts the layout on every open.
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn('size-9', className)}
            disabled={isPending}
          >
            <span className="text-base">{currentLocale?.flag}</span>
            <span className="sr-only">{t('title')}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {locales.map((loc) => (
            <DropdownMenuItem
              key={loc.code}
              onClick={() => handleLocaleChange(loc.code)}
              className={cn(locale === loc.code && 'bg-accent')}
            >
              <span className="mr-2">{loc.flag}</span>
              {loc.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  // Full mode - use Select
  return (
    <Select
      value={locale}
      onValueChange={handleLocaleChange}
      disabled={isPending}
    >
      <SelectTrigger className={cn('w-full', className)} data-testid="language-switcher">
        <SelectValue placeholder={t('title')} />
      </SelectTrigger>
      <SelectContent>
        {locales.map((loc) => (
          <SelectItem key={loc.code} value={loc.code}>
            <div className="flex items-center gap-2">
              <span>{loc.flag}</span>
              <span>{loc.label}</span>
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
