'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { Heart, Mail, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LandingSquircleIcon } from '@/components/landing/landing-squircle-icon';

export function DonationSection() {
  const t = useTranslations('LandingPage.donation');

  return (
    <section className="relative py-20 md:py-32 px-4 sm:px-6">
      <div className="max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: 'easeOut' as const }}
          className="text-center mb-12 md:mb-16"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            {t('title')}{' '}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h2>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 md:gap-6">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' as const }}
            className="rounded-2xl border border-border/40 bg-card p-7 md:p-8 flex flex-col"
          >
            <LandingSquircleIcon className="mb-5">
              <Heart className="h-6 w-6 text-white" />
            </LandingSquircleIcon>
            <h3 className="text-xl font-semibold mb-3">{t('givingTitle')}</h3>
            <p className="text-muted-foreground leading-relaxed flex-1">
              {t('description')}{' '}
              <span className="font-semibold text-foreground">
                {t('percentage')}
              </span>{' '}
              {t('description2')}{' '}
              <a
                href="https://www.givewell.org"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary hover:underline inline-flex items-center gap-1 font-medium"
              >
                {t('givewellLink')}
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              .
            </p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2, ease: 'easeOut' as const }}
            className="rounded-2xl border border-border/40 bg-card p-7 md:p-8 flex flex-col"
          >
            <LandingSquircleIcon className="mb-5">
              <Mail className="h-6 w-6 text-white" />
            </LandingSquircleIcon>
            <h3 className="text-xl font-semibold mb-3">{t('supportTitle')}</h3>
            <p className="text-muted-foreground leading-relaxed flex-1 mb-6">
              {t('supportDescription')}
            </p>
            <Button
              asChild
              variant="outline"
              className="w-full sm:w-auto gap-2 rounded-lg"
            >
              <a href={`mailto:${t('email')}`}>
                <Mail className="w-4 h-4" />
                {t('emailButton')}
              </a>
            </Button>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
