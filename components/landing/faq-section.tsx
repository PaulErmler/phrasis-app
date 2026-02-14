import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { PWAInstallButton } from './pwa-install-button';

export function FAQSection() {
  const t = useTranslations('LandingPage.faq');

  // Get FAQs from translations
  const faqs = Array.from({ length: 8 }, (_, i) => {
    const answerCount =
      i === 0
        ? 2
        : i === 1
          ? 1
          : i === 2
            ? 2
            : i === 3
              ? 2
              : i === 4
                ? 2
                : i === 5
                  ? 2
                  : i === 6
                    ? 2
                    : 1;
    return {
      question: t(`items.${i}.question`),
      answer: Array.from({ length: answerCount }, (_, j) =>
        t(`items.${i}.answer.${j}`),
      ),
      hasInstallButton: i === 7,
    };
  });
  return (
    <section id="faq" className="relative py-20 md:py-24 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-12">
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-6">
            {t('title')}{' '}
            <span className="gradient-text">{t('titleHighlight')}</span>
          </h2>
          <p className="text-lg md:text-xl text-muted-foreground">
            {t('subtitle')}
          </p>
        </div>

        {/* FAQ Accordion using native details/summary */}
        <div className="space-y-4">
          {faqs.map((faq, index) => (
            <details
              key={index}
              className="faq-details group border border-border/50 rounded-xl px-6 bg-card/50 backdrop-blur-sm open:bg-card"
            >
              <summary className="flex items-center justify-between cursor-pointer text-left text-base md:text-lg font-medium py-5 list-none [&::-webkit-details-marker]:hidden">
                {faq.question}
                <ChevronDown className="w-5 h-5 text-muted-foreground shrink-0 ml-4 transition-transform duration-200 group-open:rotate-180" />
              </summary>
              <div className="text-muted-foreground pb-5 leading-relaxed">
                <div className="space-y-3">
                  {faq.answer.map((paragraph, pIndex) => (
                    <p key={pIndex}>{paragraph}</p>
                  ))}
                </div>
                {faq.hasInstallButton && (
                  <div className="mt-4">
                    <PWAInstallButton />
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>

        {/* Still have questions */}
        <div className="text-center mt-12 p-8 rounded-2xl bg-muted/50 border border-border/30">
          <p className="text-lg font-medium mb-2">{t('contact.title')}</p>
          <p className="text-muted-foreground">
            {t('contact.description')}{' '}
            <a
              href={`mailto:${t('contact.email')}`}
              className="text-primary hover:underline"
            >
              {t('contact.email')}
            </a>
          </p>
        </div>
      </div>
    </section>
  );
}
