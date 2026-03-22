'use client';

import { useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { Heart, ExternalLink, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LandingSquircleIcon } from './landing-squircle-icon';

const TOTAL = 2;

function MobileDonationCard({
  index,
  progress,
  children,
}: {
  index: number;
  progress: MotionValue<number>;
  children: ReactNode;
}) {
  const stackIndex = useTransform(
    progress,
    (p) => index - p * (TOTAL - 1),
  );

  const y = useTransform(stackIndex, (s) => {
    if (s < 0) return s * 200;
    return 0;
  });

  const scale = useTransform(stackIndex, (s) => {
    if (s < 0) return 1 - s * -0.05;
    return 1;
  });

  const opacity = useTransform(stackIndex, (s) => {
    if (s < -0.5) return 0;
    if (s < 0) return 1 + s * 2;
    if (s > TOTAL + 1) return Math.max(0, 1 - (s - TOTAL - 1) * 0.5);
    return 1;
  });

  const zIndex = TOTAL - index;

  return (
    <motion.div
      style={{ y, scale, opacity, zIndex }}
      className="absolute inset-x-0 top-0 flex flex-col rounded-2xl border border-border/50 bg-card/95 p-8 shadow-xl backdrop-blur-md"
    >
      {children}
    </motion.div>
  );
}

export function DonationMobileStack() {
  const t = useTranslations('LandingPage.donation');
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  return (
    <div className="md:hidden">
      <div ref={containerRef} className="relative min-h-[150vh]">
        <div className="sticky top-20 z-[1] mx-auto flex w-full max-w-sm flex-col bg-background pb-2 pt-2">
          <div className="relative z-[1] mb-8 text-center">
            <h2 className="mb-4 text-3xl font-bold tracking-tight">
              {t('title')}{' '}
              <span className="gradient-text">{t('titleHighlight')}</span>
            </h2>
          </div>

          <div className="relative h-[min(52vh,420px)] w-full">
            <MobileDonationCard index={0} progress={scrollYProgress}>
              <LandingSquircleIcon variant="accent" className="mb-6">
                <Heart className="h-7 w-7 fill-white/25 text-white" />
              </LandingSquircleIcon>
              <h3 className="mb-3 text-xl font-semibold text-foreground">
                {t('givingTitle')}
              </h3>
              <p className="leading-relaxed text-muted-foreground">
                {t('description')}{' '}
                <span className="font-semibold text-foreground">
                  {t('percentage')}
                </span>{' '}
                {t('description2')}{' '}
                <a
                  href="https://www.givewell.org"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
                >
                  {t('givewellLink')}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
                .
              </p>
            </MobileDonationCard>

            <MobileDonationCard index={1} progress={scrollYProgress}>
              <LandingSquircleIcon variant="orange" className="mb-6">
                <Mail className="h-7 w-7 text-white" />
              </LandingSquircleIcon>
              <h3 className="mb-3 text-xl font-semibold text-foreground">
                {t('supportTitle')}
              </h3>
              <p className="mb-5 leading-relaxed text-muted-foreground">
                {t('supportDescription')}
              </p>
              <Button asChild variant="outline" className="w-full gap-2">
                <a href={`mailto:${t('email')}`}>
                  <Mail className="h-4 w-4" />
                  {t('emailButton')}
                </a>
              </Button>
            </MobileDonationCard>
          </div>
        </div>
      </div>
    </div>
  );
}
