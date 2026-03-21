import { Heart, ExternalLink, Mail } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';

export async function DonationSection() {
  const t = await getTranslations('LandingPage.donation');
  return (
    <section id="donate" className="relative py-10 sm:py-12 md:py-16 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="text-center mb-8 sm:mb-10">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-bold mb-3 sm:mb-4">
            {t('title')}{' '}
            <span className="gradient-text">{t('titleHighlight')}</span>
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
          <div className="rounded-2xl border border-border/50 bg-card/80 backdrop-blur-sm p-6 sm:p-8 flex flex-col">
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-accent-orange/10 mb-4">
              <Heart className="w-6 h-6 text-accent-orange fill-accent-orange/20" />
            </div>
            <h3 className="text-lg sm:text-xl font-semibold mb-3">
              10% for Good
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
            <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary/10 mb-4">
              <Mail className="w-6 h-6 text-primary" />
            </div>
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
