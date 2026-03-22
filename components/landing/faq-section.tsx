import { ChevronDown, Mail } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { PWAInstallButton } from './pwa-install-button';

interface FaqItemConfig {
  answerCount: number;
  hasInstallButton?: boolean;
  emailAction?: 'requestFeature' | 'requestLanguage';
}

const faqConfig: FaqItemConfig[] = [
  { answerCount: 2 },
  { answerCount: 5 },
  { answerCount: 2, emailAction: 'requestFeature' },
  { answerCount: 3 },
  { answerCount: 2, emailAction: 'requestLanguage' },
  { answerCount: 2 },
  { answerCount: 1 },
  { answerCount: 1 },
  { answerCount: 1, hasInstallButton: true },
];

const TATOEBA_FAQ_INDEX = 7;

export async function FAQSection() {
  const t = await getTranslations('LandingPage.faq');

  return (
    <section id="faq" className="relative py-16 sm:py-20 md:py-24 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="text-center mb-8 sm:mb-12">
          <h2 className="text-2xl sm:text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-4 sm:mb-6">
            {t('title')}{' '}
            <span className="gradient-text">{t('titleHighlight')}</span>
          </h2>
          <p className="text-base sm:text-lg md:text-xl text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>

        <div className="space-y-3 sm:space-y-4">
          {faqConfig.map((config, index) => {
            const answerParagraphs = Array.from({ length: config.answerCount }, (_, j) =>
              t(`items.${index}.answer.${j}`),
            );

            return (
              <details
                key={index}
                className="faq-details group border border-border/50 rounded-xl px-4 sm:px-6 bg-card/50 backdrop-blur-sm open:bg-card"
              >
                <summary className="flex items-center justify-between cursor-pointer text-left text-sm sm:text-base md:text-lg font-medium py-4 sm:py-5 list-none [&::-webkit-details-marker]:hidden">
                  {t(`items.${index}.question`)}
                  <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0 ml-3 sm:ml-4 transition-transform duration-200 group-open:rotate-180" />
                </summary>
                <div className="text-muted-foreground pb-4 sm:pb-5 leading-relaxed text-sm sm:text-base">
                  <div className="space-y-2.5 sm:space-y-3">
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
                      <Button asChild variant="outline" size="sm" className="gap-2">
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
            );
          })}
        </div>
      </div>
    </section>
  );
}
