import { getTranslations } from 'next-intl/server';
import { cn } from '@/lib/utils';
import { landingFeatureConfig } from './features-config';
import { FeaturesMobileStack } from './features-mobile-stack';
import { FeatureDesktopReveal } from './features-desktop-reveal';

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
      className="relative py-20 md:py-24 px-4 max-md:z-[2] max-md:isolate md:z-auto"
    >
      <div className="max-w-7xl mx-auto">
        <div className="hidden md:block text-center max-w-3xl mx-auto mb-12 md:mb-16">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-6">
            {t('title')} <span className="gradient-text">{t('titleHighlight')}</span>
          </h2>
          <p className="text-lg md:text-xl text-muted-foreground">{t('subtitle')}</p>
        </div>

        <FeaturesMobileStack
          title={t('title')}
          titleHighlight={t('titleHighlight')}
          subtitle={t('subtitle')}
          items={mobileItems}
        />

        <FeatureDesktopReveal>
          <div className="hidden md:grid md:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
            {landingFeatureConfig.map((feature, index) => (
              <div
                key={feature.key}
                className="feature-card group relative p-8 rounded-2xl border border-border/50 bg-card/50 backdrop-blur-sm"
                style={{ '--feature-delay': `${index * 0.1}s` } as React.CSSProperties}
              >
                <div className="relative w-16 h-16 mb-6 feature-icon-wrapper">
                  <div
                    className={cn(
                      'feature-icon-bg absolute top-2 left-2 w-14 h-14 rounded-[14px]',
                      feature.color === 'accent'
                        ? 'bg-[#FFB300]'
                        : 'bg-[#F97316]',
                    )}
                  />
                  <div className="feature-icon-fg absolute top-0 left-0 w-14 h-14 rounded-[14px] flex items-center justify-center shadow-lg bg-primary">
                    <feature.icon className="w-7 h-7 text-white" />
                  </div>
                </div>

                <h3 className="text-xl font-semibold mb-3 group-hover:text-primary transition-colors">
                  {t(`items.${feature.key}.title`)}
                </h3>
                <p className="text-muted-foreground leading-relaxed">
                  {t(`items.${feature.key}.description`)}
                </p>
              </div>
            ))}
          </div>
        </FeatureDesktopReveal>
      </div>
    </section>
  );
}
