import { Heart, ExternalLink, Mail } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { LandingSquircleIcon } from './landing-squircle-icon';
import { DonationMobileStack } from './donation-mobile-stack';

export async function DonationSection() {
  const t = await getTranslations('LandingPage.donation');
  return (
    <section
      id="donate"
      className="relative px-4 py-10 sm:py-12 md:py-16 max-md:z-[2] max-md:isolate md:z-auto"
    >
      <div className="max-w-5xl mx-auto">
        <div className="mb-8 hidden text-center sm:mb-10 md:block">
          <h2 className="mb-3 text-2xl font-bold sm:mb-4 sm:text-3xl md:text-4xl">
            {t('title')}{' '}
            <span className="gradient-text">{t('titleHighlight')}</span>
          </h2>
        </div>

        <DonationMobileStack />

        <div className="hidden grid-cols-1 gap-4 sm:gap-6 md:grid md:grid-cols-2">
          <div className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-6 sm:p-8 flex flex-col">
            <LandingSquircleIcon variant="accent" className="mb-4">
              <Heart className="h-7 w-7 text-white fill-white/25" />
            </LandingSquircleIcon>
            <h3 className="text-lg sm:text-xl font-semibold mb-3">
              {t('givingTitle')}
            </h3>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed flex-1">
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
          </div>

          <div className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-6 sm:p-8 flex flex-col">
            <LandingSquircleIcon variant="orange" className="mb-4">
              <Mail className="h-7 w-7 text-white" />
            </LandingSquircleIcon>
            <h3 className="text-lg sm:text-xl font-semibold mb-3">
              {t('supportTitle')}
            </h3>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed flex-1 mb-5">
              {t('supportDescription')}
            </p>
            <Button asChild variant="outline" className="w-full sm:w-auto gap-2">
              <a href={`mailto:${t('email')}`}>
                <Mail className="w-4 h-4" />
                {t('emailButton')}
              </a>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
