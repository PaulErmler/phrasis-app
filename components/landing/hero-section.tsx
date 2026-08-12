'use client';

import Link from 'next/link';
import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { ArrowRight, Download } from 'lucide-react';
import { motion } from 'motion/react';
import { Button } from '@/components/ui/button';
import { PwaInstallTrigger } from '@/components/landing/pwa-install-button';

interface HeroSectionProps {
  isAuthenticated: boolean;
}

export function HeroSection({ isAuthenticated }: HeroSectionProps) {
  const t = useTranslations('LandingPage.hero');

  return (
    <section className="relative min-h-screen flex items-center ent-hero-gradient">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full pt-24 pb-16 md:pt-32 md:pb-24">
        <div className="grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Text column */}
          <div className="space-y-8 text-center lg:text-left">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
              className="text-[2.5rem] md:text-[3.5rem] lg:text-[5rem] font-semibold tracking-tight leading-[1.08]"
            >
              {t.rich('tagline', {
                highlight: (chunks) => <span className="text-primary">{chunks}</span>,
              })}
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
              className="text-lg md:text-xl text-muted-foreground leading-relaxed max-w-xl mx-auto lg:mx-0"
            >
              {t('subtitle')}
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
              className="flex flex-col sm:flex-row items-center gap-3 sm:gap-4 lg:justify-start justify-center"
            >
              {isAuthenticated ? (
                <Button
                  asChild
                  size="lg"
                  className="w-full sm:w-auto min-w-[200px] text-base h-12 sm:h-14 rounded-lg ent-cta-orange font-semibold"
                >
                  <Link href="/app">
                    {t('cta.goToApp')}
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              ) : (
                <Button
                  asChild
                  size="lg"
                  className="w-full sm:w-auto min-w-[200px] text-base h-12 sm:h-14 rounded-lg ent-cta-orange font-semibold"
                >
                  <Link href="/auth/sign-up">
                    {t('cta.start')}
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </Link>
                </Button>
              )}
              <PwaInstallTrigger
                variant="outline"
                size="lg"
                className="w-full sm:w-auto min-w-[170px] text-base h-12 sm:h-14 rounded-lg"
              >
                <Download className="mr-2 h-5 w-5" />
                {t('cta.install')}
              </PwaInstallTrigger>
            </motion.div>
          </div>

          {/* App icon column */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.2, ease: 'easeOut' }}
            className="flex items-center justify-center lg:justify-end"
          >
            <div className="relative w-48 h-48 sm:w-56 sm:h-56 md:w-64 md:h-64 lg:w-80 lg:h-80">
              <Image
                src="/icons/icon.svg"
                alt="Flexling language learning app logo"
                className="w-full h-full drop-shadow-2xl"
                width={320}
                height={320}
                priority
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}
