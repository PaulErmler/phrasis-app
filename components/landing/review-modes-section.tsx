'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { Headphones, NotebookPen, Radio } from 'lucide-react';
import { ReviewModesDemo } from '@/components/landing/review-modes-demo';
import { fadeInUp } from './animations';

const JOBS = [
  { key: 'speak', Icon: Headphones },
  { key: 'write', Icon: NotebookPen },
  { key: 'radio', Icon: Radio },
] as const;

export function ReviewModesSection() {
  const t = useTranslations('LandingPage.reviewModes');

  return (
    <section
      id="how"
      className="relative pt-16 md:pt-24 pb-20 md:pb-32 px-4 sm:px-6 border-t border-border/40"
    >
      <div className="max-w-7xl mx-auto">
        <motion.div
          {...fadeInUp}
          className="space-y-5 max-w-3xl mb-10 md:mb-14"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            {t('title')}{' '}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
            {t('subtitle')}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 md:gap-6 mb-10 md:mb-14">
          {JOBS.map(({ key, Icon }, index) => (
            <motion.div
              key={key}
              {...fadeInUp}
              transition={{
                duration: 0.6,
                delay: 0.1 + index * 0.08,
                ease: 'easeOut' as const,
              }}
              className="relative rounded-2xl border border-border/40 bg-card p-6 md:p-7 h-full"
            >
              <div className="flex items-center gap-2.5 mb-3">
                <Icon className="h-5 w-5 text-primary shrink-0" />
                <h3 className="text-base md:text-lg font-semibold">
                  {t(`jobs.${key}.title`)}
                </h3>
              </div>
              <p className="text-xs font-medium uppercase tracking-wide text-primary mb-2">
                {t(`jobs.${key}.mode`)}
              </p>
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                {t(`jobs.${key}.body`)}
              </p>
            </motion.div>
          ))}
        </div>

        <motion.div
          {...fadeInUp}
          transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' as const }}
          className="min-w-0 max-w-4xl mx-auto"
        >
          <ReviewModesDemo />
        </motion.div>

        <motion.p
          {...fadeInUp}
          className="mt-10 md:mt-12 text-sm md:text-base text-muted-foreground leading-relaxed max-w-2xl mx-auto text-center"
        >
          {t('settingsNote')}
        </motion.p>
      </div>
    </section>
  );
}
