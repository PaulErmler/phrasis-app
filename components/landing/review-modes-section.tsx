import { getTranslations } from 'next-intl/server';
import { ReviewModesDemo } from './review-modes-demo';

export async function ReviewModesSection() {
  const t = await getTranslations('LandingPage.reviewModes');

  return (
    <section
      id="review-modes"
      className="relative py-10 md:py-14 px-4 sm:px-6 border-t border-border/60 bg-background"
    >
      <div className="max-w-7xl mx-auto">
        <header className="text-center max-w-3xl mx-auto mb-6 md:mb-8 space-y-2">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            {t('title')}{' '}
            <span className="gradient-text">{t('titleHighlight')}</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
            {t('subtitle')}
          </p>
        </header>
        <ReviewModesDemo />
      </div>
    </section>
  );
}
