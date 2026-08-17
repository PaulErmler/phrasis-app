'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { fadeInUp } from './animations';

export function HowWeAchieveSection() {
  const t = useTranslations('LandingPage.howWeAchieve');

  return (
    <section id="how" className="relative pt-16 md:pt-24 px-4 sm:px-6 border-t border-border/40">
      <div className="max-w-7xl mx-auto">
        <motion.div {...fadeInUp} className="max-w-2xl">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground mb-5">
            {t('title')}{' '}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
            {t('lead')}
          </p>
        </motion.div>
      </div>
    </section>
  );
}
