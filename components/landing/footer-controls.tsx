'use client';

import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

export function FooterControls() {
  const t = useTranslations('Footer');

  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2 text-muted-sm">
        <span>🇩🇪</span>
        <span>{t('madeInGermany')}</span>
      </div>
      <div className="w-[140px]">
        <LanguageSwitcher />
      </div>
      <ThemeSwitcher />
    </div>
  );
}
