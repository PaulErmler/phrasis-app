import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Check, X, Sprout } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { PricingCardMotion } from './pricing-mobile-motion';

const plans = [
  {
    key: 'free' as const,
    highlighted: false,
    features: ['sentences', 'customSentences', 'courses', 'chatMessages'],
  },
  {
    key: 'basic' as const,
    highlighted: true,
    features: ['sentences', 'customSentences', 'courses', 'chatMessages'],
  },
  {
    key: 'pro' as const,
    highlighted: false,
    features: [
      'sentences',
      'customSentences',
      'courses',
      'chatMessages',
      'multipleLanguages',
    ],
  },
] as const;

const traditionalIssues = [
  'limitedHours',
  'fixedSchedule',
  'noIndividualized',
  'noReview',
] as const;

type Plan = (typeof plans)[number];

type PricingT = Awaited<ReturnType<typeof getTranslations>>;

function PricingPlanCard({
  plan,
  index,
  layout,
  t,
}: {
  plan: Plan;
  index: number;
  layout: 'mobile' | 'desktop';
  t: PricingT;
}) {
  const isDesktop = layout === 'desktop';

  return (
    <div
      className={cn(
        'group relative flex h-full flex-col rounded-2xl border',
        isDesktop
          ? cn(
              'pricing-card p-6 sm:p-8',
              'bg-card opacity-0 animate-fade-in-up',
              plan.highlighted
                ? 'border-primary/50 shadow-lg shadow-primary/10'
                : 'border-border/50',
            )
          : cn(
              'p-8',
              'border-border/50 bg-card/50 backdrop-blur-sm',
              plan.highlighted && 'border-primary/50 shadow-lg shadow-primary/10',
            ),
      )}
      style={
        isDesktop
          ? {
              animationDelay: `${index * 0.1}s`,
              animationFillMode: 'forwards',
            }
          : undefined
      }
    >
      {plan.highlighted && (
        <div className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 py-1 text-xs font-bold text-white">
          <Sprout className="h-3 w-3" />
          Most Popular
        </div>
      )}

      <div className="mb-5 sm:mb-6">
        <h3 className="mb-1 text-lg font-semibold sm:mb-2 sm:text-xl">
          {t(`plans.${plan.key}.name`)}
        </h3>
        <p className="text-muted-sm">{t(`plans.${plan.key}.description`)}</p>
      </div>

      <div className="mb-5 sm:mb-6">
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold sm:text-4xl md:text-5xl">
            {t(`plans.${plan.key}.price`)}
          </span>
          <span className="text-sm text-muted-foreground">
            /{t(`plans.${plan.key}.period`)}
          </span>
        </div>
      </div>

      <ul className="mb-6 flex-1 space-y-2.5 sm:mb-8 sm:space-y-3">
        {plan.features.map((featureKey) => (
          <li key={featureKey} className="flex items-start gap-2.5 sm:gap-3">
            <div
              className={cn(
                'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full',
                plan.highlighted ? 'bg-primary/20' : 'bg-muted',
              )}
            >
              <Check
                className={cn(
                  'h-3 w-3',
                  plan.highlighted ? 'text-primary' : 'text-foreground',
                )}
              />
            </div>
            <span className="text-sm">
              {t(`plans.${plan.key}.features.${featureKey}`)}
            </span>
          </li>
        ))}
      </ul>

      <Button
        asChild
        variant={plan.highlighted ? 'default' : 'outline'}
        size="lg"
        className={cn('w-full text-base', plan.highlighted && 'shadow-none')}
      >
        <Link href="/auth/sign-up">{t(`plans.${plan.key}.cta`)}</Link>
      </Button>
    </div>
  );
}

export async function PricingSection() {
  const t = await getTranslations('LandingPage.pricing');

  return (
    <section
      id="pricing"
      className="relative z-0 px-4 py-16 sm:py-20 md:py-24 pricing-gradient"
    >
      <div className="relative mx-auto max-w-7xl">
        <div className="mx-auto mb-10 max-w-3xl text-center sm:mb-12">
          <h2 className="mb-4 text-3xl font-bold tracking-tight sm:mb-6 md:text-4xl lg:text-5xl">
            {t('title')} <span className="gradient-text">{t('titleHighlight')}</span>
          </h2>
        </div>

        <div className="mx-auto max-w-6xl">
          <div className="mx-auto flex w-full max-w-sm flex-col gap-6 py-6 md:hidden">
            {plans.map((plan, index) => (
              <PricingCardMotion key={plan.key} index={index}>
                <PricingPlanCard plan={plan} index={index} layout="mobile" t={t} />
              </PricingCardMotion>
            ))}
          </div>

          <div className="hidden grid-cols-3 gap-6 py-6 md:grid md:py-12">
            {plans.map((plan, index) => (
              <PricingPlanCard
                key={plan.key}
                plan={plan}
                index={index}
                layout="desktop"
                t={t}
              />
            ))}
          </div>
        </div>

        <div className="mt-8 sm:mt-12 md:mt-16 py-6 sm:py-10">
          <div className="mx-auto max-w-5xl rounded-2xl border border-border/50 bg-muted/30 p-5 sm:p-6 md:p-10">
            <div className="grid grid-cols-1 gap-6 sm:gap-8 md:grid-cols-2 md:gap-10 lg:gap-12">
              <div className="space-y-3 text-center sm:space-y-4 md:space-y-5 md:pr-4 md:text-left">
                <h2 className="text-lg font-bold text-muted-foreground sm:text-xl md:text-2xl">
                  {t('comparison.comparedWith')}
                </h2>
                <h3 className="text-xl font-bold text-muted-foreground sm:text-2xl lg:text-3xl">
                  {t('comparison.traditionalCourses')}
                </h3>
                <div className="pt-2 md:pt-4">
                  <div className="flex flex-col items-center gap-1 md:flex-row md:items-baseline md:gap-2">
                    <span className="text-2xl font-bold text-muted-foreground sm:text-3xl lg:text-4xl">
                      {t('comparison.price')}
                    </span>
                    <span className="text-sm text-muted-foreground/70 md:text-base">
                      {t('comparison.period')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-3 sm:space-y-4 md:space-y-5 md:border-l md:border-border/30 md:pl-4">
                <h4 className="text-center text-base font-semibold text-muted-foreground sm:text-lg md:text-left md:text-xl">
                  {t('comparison.whatYouGet')}
                </h4>
                <div className="space-y-2.5 sm:space-y-3 md:space-y-3.5">
                  {traditionalIssues.map((issueKey) => (
                    <div
                      key={issueKey}
                      className="flex items-start gap-2.5 md:gap-3"
                    >
                      <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-muted md:h-6 md:w-6">
                        <X className="h-3 w-3 text-muted-foreground/60 md:h-3.5 md:w-3.5" />
                      </div>
                      <span className="text-sm leading-relaxed text-muted-foreground md:text-base">
                        {t(`comparison.issues.${issueKey}`)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
