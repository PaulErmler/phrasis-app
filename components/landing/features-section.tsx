import { getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';
import { landingFeatureConfig } from './features-config';
import { FeaturesMobileStack } from './features-mobile-stack';
import { FeatureDesktopReveal } from './features-desktop-reveal';
import { LandingSquircleIcon } from './landing-squircle-icon';

export async function FeaturesSection() {
  const t = await getTranslations('LandingPage.features');

  const mobileItems = Object.fromEntries(
    landingFeatureConfig.map((f) => [
      f.key,
      {
        title: t(`items.${f.key}.title`),
        description: t(`items.${f.key}.description`),
      },
    ]),
  ) as Record<(typeof landingFeatureConfig)[number]['key'], { title: string; description: string }>;

  return (
    <section
      id="features"
      className="relative py-20 md:py-24 px-4 max-md:z-[2] max-md:isolate md:z-auto border-t border-border/60 bg-muted/10"
    >
      <div className="max-w-7xl mx-auto">
        <div className="hidden md:block text-center max-w-3xl mx-auto mb-12 md:mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground mb-4">
            {t('title')}{' '}
            <span className="gradient-text">{t('titleHighlight')}</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">{t('subtitle')}</p>
        </div>

        <FeaturesMobileStack
          items={mobileItems}
          title={<>{t('title')} <span className="gradient-text">{t('titleHighlight')}</span></>}
          subtitle={t('subtitle')}
        />

        <FeatureDesktopReveal>
          <div
            className={cn(
              'grid gap-6 sm:grid-cols-2 lg:grid-cols-3',
              'opacity-0 animate-fade-in-up',
            )}
            style={{ animationFillMode: 'forwards', animationDuration: '0.6s' }}
          >
            {landingFeatureConfig.map((f, index) => {
              const Icon = f.icon;
              return (
                <div
                  key={f.key}
                  className="group relative flex flex-col rounded-2xl border border-border/50 bg-card/60 p-6 md:p-8 shadow-sm transition-shadow hover:shadow-md"
                  style={{ animationDelay: `${index * 0.08}s` }}
                >
                  <LandingSquircleIcon variant={index % 2 === 0 ? 'accent' : 'orange'} className="mb-5">
                    <Icon className="h-7 w-7 text-white" />
                  </LandingSquircleIcon>
                  <h3 className="text-lg font-semibold text-foreground mb-2">
                    {t(`items.${f.key}.title`)}
                  </h3>
                  <p className="text-sm md:text-base text-muted-foreground leading-relaxed">
                    {t(`items.${f.key}.description`)}
                  </p>
                </div>
              );
            })}
          </div>
        </FeatureDesktopReveal>
      </div>
    </section>
  );
}
