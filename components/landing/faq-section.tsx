'use client';

import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { ChevronDown, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { landingFaqConfig, TATOEBA_FAQ_INDEX } from '@/components/landing/faq-config';
import { PWAInstallButton } from '@/components/landing/pwa-install-button';

export function FAQSection() {
  const t = useTranslations('LandingPage.faq');

  return (
    <section id="faq" className="relative py-20 md:py-32 px-4 sm:px-6 bg-muted/10">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className="text-center mb-12 md:mb-16"
        >
          <p className="ent-section-label mb-4">Questions & Answers</p>
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground mb-4">
            {t('title')}{' '}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground">
            {t('subtitle')}
          </p>
        </motion.div>

        <div className="space-y-3">
          {landingFaqConfig.map((config, index) => {
            const answerParagraphs = Array.from(
              { length: config.answerCount },
              (_, j) => t(`items.${index}.answer.${j}`),
            );

            return (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{
                  duration: 0.4,
                  delay: index * 0.04,
                  ease: 'easeOut',
                }}
              >
                <details className="ent-faq-details group border border-border/40 rounded-xl px-5 sm:px-6 bg-card/50 open:bg-card transition-colors">
                  <summary className="flex items-center justify-between cursor-pointer text-left text-sm sm:text-base md:text-lg font-medium py-5 list-none [&::-webkit-details-marker]:hidden">
                    {t(`items.${index}.question`)}
                    <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0 ml-4 transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <div className="text-muted-foreground pb-5 leading-relaxed text-sm sm:text-base">
                    <div className="space-y-3">
                      {index === TATOEBA_FAQ_INDEX && (
                        <p>
                          {t(`items.${index}.tatoebaPrefix`)}
                          <a
                            href="https://tatoeba.org/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline font-medium"
                          >
                            {t('links.tatoeba')}
                          </a>
                          {t(`items.${index}.tatoebaMid`)}
                          <a
                            href="https://creativecommons.org/licenses/by/2.0/fr/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary hover:underline font-medium"
                          >
                            {t('links.ccByLicense')}
                          </a>
                          {t(`items.${index}.tatoebaSuffix`)}
                        </p>
                      )}
                      {answerParagraphs.map((paragraph, pIndex) => (
                        <p key={pIndex}>{paragraph}</p>
                      ))}
                    </div>
                    {config.emailAction && (
                      <div className="mt-4">
                        <Button
                          asChild
                          variant="outline"
                          size="sm"
                          className="gap-2 rounded-lg"
                        >
                          <a
                            href={`mailto:support@flexling.com?subject=${encodeURIComponent(t(`emailSubjects.${config.emailAction}`))}`}
                          >
                            <Mail className="w-4 h-4" />
                            {t(config.emailAction)}
                          </a>
                        </Button>
                      </div>
                    )}
                    {config.hasInstallButton && (
                      <div className="mt-4">
                        <PWAInstallButton />
                      </div>
                    )}
                  </div>
                </details>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
