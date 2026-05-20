'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { Check, X, Sprout } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

const plans = [
  {
    key: 'free' as const,
    highlighted: false,
    hasTrial: false,
    features: ['sentences', 'customSentences', 'courses', 'chatMessages', 'detailedStatistics'],
  },
  {
    key: 'basic' as const,
    highlighted: true,
    hasTrial: true,
    features: ['sentences', 'customSentences', 'courses', 'chatMessages', 'detailedStatistics'],
  },
  {
    key: 'pro' as const,
    highlighted: false,
    hasTrial: true,
    features: [
      'sentences',
      'customSentences',
      'courses',
      'chatMessages',
      'multipleLanguages',
      'detailedStatistics',
    ],
  },
] as const;

const traditionalIssues = [
  'limitedHours',
  'fixedSchedule',
  'noIndividualized',
  'noReview',
] as const;

export function PricingSection() {
  const t = useTranslations('LandingPage.pricing');

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
          className="text-center max-w-3xl mx-auto mb-14 md:mb-20"
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            {t('title')}{' '}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h2>
        </motion.div>

        <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-5 lg:gap-8">
          {plans.map((plan, index) => (
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
                  <span className="text-4xl md:text-5xl font-bold">
                    {t(`plans.${plan.key}.price`)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    /{t(`plans.${plan.key}.period`)}
                  </span>
                </div>
                {plan.hasTrial && (
                  <p
                    className={cn(
                      'mt-2 text-sm font-medium',
                      plan.highlighted ? 'text-primary' : 'text-foreground/80',
                    )}
                  >
                    {t(`plans.${plan.key}.trial`)}
                  </p>
                )}
              </div>

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
                <Link href="/auth/sign-up">
                  {t(`plans.${plan.key}.cta`)}
                </Link>
              </Button>
            </motion.div>
          ))}
        </div>

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
                    <div
                      key={issueKey}
                      className="flex items-start gap-3"
                    >
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
