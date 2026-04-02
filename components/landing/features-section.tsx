'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { cn } from '@/lib/utils';
import { landingFeatureConfig } from '@/components/landing/features-config';
import { LandingSquircleIcon } from '@/components/landing/landing-squircle-icon';

export function FeaturesSection() {
  const t = useTranslations('LandingPage.features');

  return (
    <section
      id="features"
      className="relative py-20 md:py-32 px-4 sm:px-6 border-t border-border/40 bg-muted/10"
    >
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: 'easeOut' as const }}
          className="max-w-2xl mb-14 md:mb-20"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground mb-4">
            {t('title')}{' '}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
            {t('subtitle')}
          </p>
        </motion.div>

        {/* Row 1: 2 large cards */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 md:gap-6 mb-5 md:mb-6">
          {landingFeatureConfig.slice(0, 2).map((f, index) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.key}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.5,
                  delay: index * 0.08,
                  ease: 'easeOut' as const,
                }}
                className="ent-bento-card relative flex flex-col rounded-2xl border border-border/40 bg-card p-8 md:p-10"
              >
                <LandingSquircleIcon className="mb-6">
                  <Icon className="h-6 w-6 text-white" />
                </LandingSquircleIcon>
                <h3 className="text-xl md:text-2xl font-semibold mb-3">
                  {t(`items.${f.key}.title`)}
                </h3>
                <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
                  {t(`items.${f.key}.description`)}
                </p>
              </motion.div>
            );
          })}
        </div>

        {/* Row 2: 4 smaller cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 md:gap-6">
          {landingFeatureConfig.slice(2).map((f, index) => {
            const Icon = f.icon;
            return (
              <motion.div
                key={f.key}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.5,
                  delay: (index + 2) * 0.08,
                  ease: 'easeOut' as const,
                }}
                className="ent-bento-card relative flex flex-col rounded-2xl border border-border/40 bg-card p-7 md:p-8"
              >
                <LandingSquircleIcon className="mb-5">
                  <Icon className="h-6 w-6 text-white" />
                </LandingSquircleIcon>
                <h3 className="text-lg font-semibold mb-2">
                  {t(`items.${f.key}.title`)}
                </h3>
                <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                  {t(`items.${f.key}.description`)}
                </p>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
