'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { Check, X, Sprout } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

/**
 * Each tier lists only what it ADDS over the one below, under an "Everything
 * from X, plus:" line. The same structure as the in-app pricing table
 * (`itemsAddedOver` in components/autumn/pricing-table.tsx). Anything the
 * lower tier already grants is inherited, not repeated: Basic and Free both
 * cap at 1 course, Pro and Ultra both give unlimited sentences.
 *
 * Credit lines are INCREMENTS, so the card adds up: Free's 30/month +
 * Basic's 400 + Pro's 600 + Ultra's 2,000 are the 30 / 430 / 1,030 / 3,030
 * the plans actually grant. Keep in step with autumn.config.ts.
 */
const plans = [
  {
    key: 'free' as const,
    previous: null,
    highlighted: false,
    hasTrial: false,
    paid: false,
    features: [
      'sentences',
      'credits',
      'creditsHint',
      'courses',
      'detailedStatistics',
    ],
  },
  {
    key: 'basic' as const,
    previous: 'free' as const,
    highlighted: false,
    hasTrial: true,
    paid: true,
    features: ['sentences', 'credits'],
  },
  {
    key: 'pro' as const,
    previous: 'basic' as const,
    highlighted: true,
    hasTrial: true,
    paid: true,
    features: ['credits', 'courses', 'multipleLanguages'],
  },
  {
    key: 'ultra' as const,
    previous: 'pro' as const,
    highlighted: false,
    hasTrial: true,
    paid: true,
    features: [
      'credits',
      // Display-only, no Autumn feature backs these.
      'priorityFeatureAccess',
      'prioritySupport',
    ],
  },
] as const;

const traditionalIssues = [
  'limitedHours',
  'fixedSchedule',
  'noIndividualized',
  'noReview',
] as const;

type Billing = 'monthly' | 'yearly';

function BillingToggle({
  billing,
  setBilling,
  t,
}: {
  billing: Billing;
  setBilling: (b: Billing) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="inline-flex items-center rounded-full border border-border/60 bg-muted/40 p-1">
      {(['monthly', 'yearly'] as const).map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => setBilling(option)}
          aria-pressed={billing === option}
          className={cn(
            'flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
            billing === option
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {t(`billing.${option}`)}
          {option === 'yearly' && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
              {t('billing.save')}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

export function PricingSection() {
  const t = useTranslations('LandingPage.pricing');
  const [billing, setBilling] = useState<Billing>('yearly');
  const isYearly = billing === 'yearly';

  return (
    <section
      id="pricing"
      className="relative py-20 md:py-32 px-4 sm:px-6 border-t border-border/40"
    >
      <div className="max-w-7xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="text-center max-w-3xl mx-auto mb-10 md:mb-14"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            {t('title')}{' '}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h2>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.5, delay: 0.1, ease: 'easeOut' }}
          className="flex justify-center mb-10 md:mb-14"
        >
          <BillingToggle billing={billing} setBilling={setBilling} t={t} />
        </motion.div>

        <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 md:gap-5 lg:gap-6">
          {plans.map((plan, index) => {
            // Yearly billing shows the effective per-month price as the
            // headline, with the billed-annually total as a subline.
            const price = plan.paid
              ? t(
                  `plans.${plan.key}.${isYearly ? 'priceYearlyPerMonth' : 'priceMonthly'}`,
                )
              : t(`plans.${plan.key}.price`);
            const period = t(`plans.${plan.key}.period`);

            return (
              <motion.div
                key={plan.key}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.5,
                  delay: index * 0.1,
                  ease: 'easeOut',
                }}
                className={cn(
                  'relative flex flex-col rounded-2xl border p-7 md:p-8 transition-shadow duration-300',
                  plan.highlighted
                    ? 'border-primary/50 shadow-xl shadow-primary/10 bg-card'
                    : 'border-border/40 bg-card hover:shadow-lg',
                )}
              >
                {plan.highlighted && (
                  <div className="absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-primary px-4 py-1 text-xs font-bold text-white">
                    <Sprout className="h-3 w-3" />
                    {t('mostPopular')}
                  </div>
                )}

                <div className="mb-6">
                  <h3 className="text-lg font-semibold mb-1">
                    {t(`plans.${plan.key}.name`)}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {t(`plans.${plan.key}.description`)}
                  </p>
                </div>

                <div className="mb-6">
                  <div className="flex items-baseline gap-1">
                    <motion.span
                      key={`${plan.key}-${billing}`}
                      initial={{ opacity: 0, y: -6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, ease: 'easeOut' }}
                      className="text-4xl md:text-5xl font-bold"
                    >
                      {price}
                    </motion.span>
                    <span className="text-sm text-muted-foreground">
                      /{period}
                    </span>
                  </div>
                  <div className="mt-2 min-h-5">
                    {plan.paid && isYearly && (
                      <p className="text-sm text-muted-foreground">
                        {t(`plans.${plan.key}.billedAnnually`)}
                      </p>
                    )}
                  </div>
                  {plan.hasTrial && (
                    <p
                      className={cn(
                        'mt-1 text-sm font-medium',
                        plan.highlighted
                          ? 'text-primary'
                          : 'text-foreground/80',
                      )}
                    >
                      {t(`plans.${plan.key}.trial`)}
                    </p>
                  )}
                </div>

                {plan.previous && (
                  <p className="mb-3 text-sm font-medium">
                    {t('everythingFrom', {
                      planName: t(`plans.${plan.previous}.name`),
                    })}
                  </p>
                )}

                <ul className="mb-8 flex-1 space-y-3">
                  {plan.features.map((featureKey) => (
                    <li key={featureKey} className="flex items-start gap-3">
                      <div
                        className={cn(
                          'mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full',
                          plan.highlighted ? 'bg-primary/20' : 'bg-muted',
                        )}
                      >
                        <Check
                          className={cn(
                            'h-3 w-3',
                            plan.highlighted
                              ? 'text-primary'
                              : 'text-foreground',
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
                  className={cn(
                    'w-full text-base rounded-lg',
                    plan.highlighted && 'ent-cta-orange font-semibold',
                  )}
                >
                  <Link href="/auth/sign-up">{t(`plans.${plan.key}.cta`)}</Link>
                </Button>
              </motion.div>
            );
          })}
        </div>

        {/* Paid plans are sold with Stripe as merchant of record, so the
            listed price is the gross amount and any VAT is carved out of it
            rather than added at checkout. Stated once under the grid rather
            than per card. It applies to every paid plan equally. */}
        <p className="mt-6 text-center text-xs text-muted-foreground">
          {t('taxNote')}
        </p>

        {/* Comparison block */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
          className="mt-16 md:mt-20"
        >
          <div className="mx-auto max-w-5xl rounded-2xl border border-border/40 bg-muted/30 p-6 md:p-10">
            <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:gap-10 lg:gap-12">
              <div className="space-y-4 text-center md:text-left">
                <h2 className="text-lg font-bold text-muted-foreground md:text-2xl">
                  {t('comparison.comparedWith')}
                </h2>
                <h3 className="text-xl font-bold text-muted-foreground md:text-3xl">
                  {t('comparison.traditionalCourses')}
                </h3>
                <div className="pt-2">
                  <div className="flex flex-col items-center gap-1 md:flex-row md:items-baseline md:gap-2">
                    <span className="text-3xl font-bold text-muted-foreground md:text-4xl">
                      {t('comparison.price')}
                    </span>
                    <span className="text-sm text-muted-foreground/70">
                      {t('comparison.period')}
                    </span>
                  </div>
                </div>
              </div>

              <div className="space-y-4 md:border-l md:border-border/30 md:pl-6">
                <h4 className="text-center text-base font-semibold text-muted-foreground md:text-left md:text-xl">
                  {t('comparison.whatYouGet')}
                </h4>
                <div className="space-y-3">
                  {traditionalIssues.map((issueKey) => (
                    <div key={issueKey} className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-muted">
                        <X className="h-3 w-3 text-muted-foreground/60" />
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
        </motion.div>
      </div>
    </section>
  );
}
