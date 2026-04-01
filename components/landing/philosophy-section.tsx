'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { RefreshCw, BookOpen, Pencil } from 'lucide-react';
import { LandingSquircleIcon } from '@/components/landing/landing-squircle-icon';

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6, ease: 'easeOut' as const },
};

const pillarIcons = [RefreshCw, BookOpen, Pencil];

export function PhilosophySection() {
  const t = useTranslations('LandingPage.philosophy');

  const pillars = [
    { number: '01', title: t('pillar1Title'), body: t('pillar1Body') },
    { number: '02', title: t('pillar2Title'), body: t('pillar2Body') },
    { number: '03', title: t('pillar3Title'), body: t('pillar3Body') },
  ];

  return (
    <section id="philosophy" className="relative py-20 md:py-32 px-4 sm:px-6">
      <div className="max-w-7xl mx-auto">
        <motion.div
          {...fadeInUp}
          className="mb-14 md:mb-20 max-w-2xl"
        >
          <p className="ent-section-label mb-4">Our Approach</p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground mb-5">
            {t('title')}{' '}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
            {t('lead')}
          </p>
        </motion.div>

        {/* Asymmetric grid */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-5 md:gap-6">
          {/* Row 1: pillar 1 (col-span-7) + pillar 2 (col-span-5) */}
          <motion.div
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' as const }}
            className="relative md:col-span-7 rounded-2xl border border-border/40 bg-card p-8 md:p-10 overflow-hidden"
          >
            <span className="ent-pillar-number">{pillars[0].number}</span>
            <LandingSquircleIcon className="mb-5 relative">
              <RefreshCw className="h-6 w-6 text-white" />
            </LandingSquircleIcon>
            <h3 className="text-xl md:text-2xl font-semibold mb-3 relative">
              {pillars[0].title}
            </h3>
            <p className="text-muted-foreground leading-relaxed relative">
              {pillars[0].body}
            </p>
          </motion.div>

          <motion.div
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' as const }}
            className="relative md:col-span-5 rounded-2xl border border-border/40 bg-card p-8 md:p-10 overflow-hidden"
          >
            <span className="ent-pillar-number">{pillars[1].number}</span>
            <LandingSquircleIcon className="mb-5 relative">
              <BookOpen className="h-6 w-6 text-white" />
            </LandingSquircleIcon>
            <h3 className="text-xl md:text-2xl font-semibold mb-3 relative">
              {pillars[1].title}
            </h3>
            <p className="text-muted-foreground leading-relaxed relative">
              {pillars[1].body}
            </p>
          </motion.div>

          {/* Row 2: pillar 3, centered col-span-8 */}
          <motion.div
            {...fadeInUp}
            transition={{ duration: 0.6, delay: 0.3, ease: 'easeOut' as const }}
            className="relative md:col-span-8 md:col-start-3 rounded-2xl border border-border/40 bg-card p-8 md:p-10 overflow-hidden"
          >
            <span className="ent-pillar-number">{pillars[2].number}</span>
            <LandingSquircleIcon className="mb-5 relative">
              <Pencil className="h-6 w-6 text-white" />
            </LandingSquircleIcon>
            <h3 className="text-xl md:text-2xl font-semibold mb-3 relative">
              {pillars[2].title}
            </h3>
            <p className="text-muted-foreground leading-relaxed relative">
              {pillars[2].body}
            </p>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
