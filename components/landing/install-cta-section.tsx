'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { Download } from 'lucide-react';
import { PwaInstallTrigger } from '@/components/landing/pwa-install-button';

export function InstallCtaSection() {
  const t = useTranslations('LandingPage.installCta');

  return (
    <section className="relative py-20 md:py-32 px-4 sm:px-6 ent-install-gradient">
      <div className="max-w-3xl mx-auto text-center">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="space-y-8"
        >
          <Image
            src="/icons/icon.svg"
            alt="Flexling language learning app logo"
            className="w-16 h-16 sm:w-20 sm:h-20 mx-auto"
            width={80}
            height={80}
          />

          <h2 className="text-3xl md:text-4xl lg:text-5xl font-semibold tracking-tight">
            {t('title')}
          </h2>

          <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
            {t('subtitle')}
          </p>

          <PwaInstallTrigger
            size="lg"
            className="text-lg h-14 px-10 rounded-lg ent-cta-orange font-semibold"
          >
            <Download className="mr-2 h-5 w-5" />
            {t('button')}
          </PwaInstallTrigger>

          <p className="text-sm text-muted-foreground/60">{t('note')}</p>
        </motion.div>
      </div>
    </section>
  );
}
