'use client';

import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { setUserLocale } from "@/i18n/locale";
import { cn } from "@/lib/utils";

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

export function LanguageSwitcher({ compact = false, className }: LanguageSwitcherProps) {
  const locale = useLocale();
  const t = useTranslations("Language");
  const [mounted, setMounted] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setMounted(true);
  }, []);

  const handleLocaleChange = (newLocale: string) => {
    startTransition(() => {
      setUserLocale(newLocale as 'en' | 'de');
    });
  };

  const currentLocale = locales.find((l) => l.code === locale);

  // Compact mode - use DropdownMenu like ThemeSwitcher
  if (compact) {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button 
            variant="ghost" 
            size="icon" 
            className={cn("size-9", className)} 
            disabled={isPending || !mounted}
          >
            <span className="text-base">{currentLocale?.flag}</span>
            <span className="sr-only">{t("title")}</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {locales.map((loc) => (
            <DropdownMenuItem
              key={loc.code}
              onClick={() => handleLocaleChange(loc.code)}
              className={cn(locale === loc.code && "bg-accent")}
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
    <Select value={locale} onValueChange={handleLocaleChange} disabled={isPending || !mounted}>
      <SelectTrigger className={cn("w-full", className)}>
        <SelectValue placeholder={t("title")} />
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
