'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { ReviewModesDemo } from '@/components/landing/review-modes-demo';

export function ReviewModesSection() {
  const t = useTranslations('LandingPage.reviewModes');

  return (
    <section
      id="review-modes"
      className="relative py-20 md:py-32 px-4 sm:px-6 border-t border-border/40"
    >
      <div className="max-w-7xl mx-auto">
        {/* Text on top */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: 'easeOut' as const }}
          className="space-y-5 max-w-3xl mb-10 md:mb-14"
        >
          <p className="ent-section-label">How It Works</p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            {t('title')}{' '}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
            {t('subtitle')}
          </p>
        </motion.div>

        {/* Demo below at full width */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' as const }}
          className="min-w-0 max-w-4xl mx-auto"
        >
          <ReviewModesDemo />
        </motion.div>
      </div>
    </section>
  );
}
