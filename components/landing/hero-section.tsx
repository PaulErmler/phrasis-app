import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { ArrowRight, Download } from 'lucide-react';
import { LandingHeader } from './landing-header';
import { PwaInstallTrigger } from './pwa-install-button';

interface HeroSectionProps {
  isAuthenticated: boolean;
}

export async function HeroSection({ isAuthenticated }: HeroSectionProps) {
  const t = await getTranslations('LandingPage.hero');

  return (
    <section className="relative min-h-[90vh] flex flex-col items-center justify-center px-4 py-20 md:py-32 overflow-hidden hero-gradient noise-bg">
      <LandingHeader isAuthenticated={isAuthenticated} />

      <div className="relative z-10 w-full max-w-5xl mx-auto text-center space-y-8 animate-fade-in-up">
        <div className="inline-flex items-center justify-center w-36 h-36 sm:w-44 sm:h-44 md:w-48 md:h-48">
          <img
            src="/icons/icon.svg"
            alt="Flexling Logo"
            className="w-full h-full"
            width={500}
            height={500}
          />
        </div>

        <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-7xl font-bold tracking-tight text-foreground leading-[1.1] flex flex-col items-center gap-1 sm:gap-2">
          <span className="gradient-text">Flexling</span>
          <span>{t('tagline')}.</span>
        </h1>

        <p className="text-base sm:text-lg md:text-xl lg:text-2xl text-muted-foreground max-w-3xl mx-auto stagger-1 leading-relaxed">
          {t('subtitle')}
        </p>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4 pt-4 stagger-3">
          {isAuthenticated ? (
            <Button
              asChild
              size="lg"
              className="w-full sm:w-auto min-w-[200px] text-base sm:text-lg h-12 sm:h-14 shadow-xl shadow-primary/20"
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
              className="w-full sm:w-auto min-w-[200px] text-base sm:text-lg h-12 sm:h-14 shadow-xl shadow-primary/20"
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
            className="w-full sm:w-auto min-w-[170px] text-base sm:text-lg h-12 sm:h-14"
          >
            <Download className="mr-2 h-5 w-5" />
            {t('cta.install')}
          </PwaInstallTrigger>
        </div>
      </div>
    </section>
  );
}
