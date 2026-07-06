'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { RefreshCw, Sprout, Clock, Target, SlidersHorizontal, Zap } from 'lucide-react';
import { LandingSquircleIcon } from '@/components/landing/landing-squircle-icon';

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6, ease: 'easeOut' as const },
};

const CARDS = [
  { key: 'activeRecall', Icon: RefreshCw },
  { key: 'grammar', Icon: Sprout },
  { key: 'daily', Icon: Clock },
  { key: 'practical', Icon: Target },
  { key: 'customisation', Icon: SlidersHorizontal },
  { key: 'feedback', Icon: Zap },
] as const;

export function PhilosophySection() {
  const t = useTranslations('LandingPage.philosophy');

  return (
    <section id="philosophy" className="relative py-20 md:py-32 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div {...fadeInUp} className="mb-14 md:mb-20 max-w-2xl">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground mb-5">
            {t('title')}{' '}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
            {t('lead')}
          </p>
        </motion.div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 md:gap-6">
          {CARDS.map(({ key, Icon }, index) => (
            <motion.div
              key={key}
              {...fadeInUp}
              transition={{
                duration: 0.6,
                delay: 0.1 + index * 0.08,
                ease: 'easeOut' as const,
              }}
              className="relative rounded-2xl border border-border/40 bg-card p-7 md:p-8 h-full"
            >
              <LandingSquircleIcon className="mb-5">
                <Icon className="h-6 w-6 text-white" />
              </LandingSquircleIcon>
              <h3 className="text-lg md:text-xl font-semibold mb-3">
                {t(`cards.${key}.title`)}
              </h3>
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                {t(`cards.${key}.body`)}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
