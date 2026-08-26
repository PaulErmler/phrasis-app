'use client';

import { useMemo } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { Mail } from 'lucide-react';
import {
  SUPPORTED_LANGUAGES,
  getLocalizedLanguageNameByCode,
} from '@/lib/languages';
import { fadeInUp } from './animations';

export function LanguagesSection() {
  const t = useTranslations('LandingPage.languages');
  const tFaq = useTranslations('LandingPage.faq');
  const locale = useLocale();

  const languages = useMemo(() => {
    const visible = SUPPORTED_LANGUAGES.filter((l) => !l.hiddenFromPicker);
    return visible
      .map((l) => ({
        code: l.code,
        flag: l.flag,
        name: getLocalizedLanguageNameByCode(l.code, locale),
        experimental: l.experimental ?? false,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
  }, [locale]);

  // Round down to a stable marketing number ("50+") so the headline doesn't
  // wobble every time a variant is added or hidden.
  const count = Math.floor(languages.length / 10) * 10;

  return (
    <section id="languages" className="relative py-20 md:py-32 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div {...fadeInUp} className="mb-12 md:mb-16 max-w-2xl">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground mb-5">
            {t('title')}{' '}
            <span className="text-primary">
              {t('titleHighlight', { count })}
            </span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
            {t('lead')}
          </p>
        </motion.div>

        <motion.ul
          {...fadeInUp}
          transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' as const }}
          className="flex flex-wrap gap-2.5 md:gap-3"
        >
          {languages.map((lang) => (
            <li
              key={lang.code}
              className="flex items-center gap-2 rounded-full border border-border/40 bg-card px-3.5 py-1.5 text-sm md:text-base"
              title={
                lang.experimental ? t('experimentalBadgeTooltip') : undefined
              }
            >
              <span aria-hidden="true">{lang.flag}</span>
              <span>{lang.name}</span>
              {lang.experimental && (
                <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {t('experimentalBadge')}
                </span>
              )}
            </li>
          ))}
          <li>
            <a
              href={`mailto:support@flexling.com?subject=${encodeURIComponent(tFaq('emailSubjects.requestLanguage'))}`}
              className="flex items-center gap-2 rounded-full border border-dashed border-primary/50 bg-primary/5 px-3.5 py-1.5 text-sm md:text-base font-medium text-primary transition-colors hover:bg-primary/10"
            >
              <Mail className="h-4 w-4" aria-hidden="true" />
              <span>{t('missingPill')}</span>
            </a>
          </li>
        </motion.ul>
      </div>
    </section>
  );
}
