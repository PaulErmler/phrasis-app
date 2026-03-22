import { getTranslations } from 'next-intl/server';
import { landingFaqConfig, TATOEBA_FAQ_INDEX } from './faq-config';

interface LandingJsonLdProps {
  siteUrl: string;
}

function buildFaqAnswerText(
  t: Awaited<ReturnType<typeof getTranslations<'LandingPage.faq'>>>,
  index: number,
  answerCount: number,
): string {
  const parts: string[] = [];
  if (index === TATOEBA_FAQ_INDEX) {
    parts.push(
      `${t(`items.${index}.tatoebaPrefix`)}${t('links.tatoeba')}${t(`items.${index}.tatoebaMid`)}${t('links.ccByLicense')}${t(`items.${index}.tatoebaSuffix`)}`,
    );
  }
  for (let j = 0; j < answerCount; j++) {
    parts.push(t(`items.${index}.answer.${j}`));
  }
  return parts.join(' ');
}

export async function LandingJsonLd({ siteUrl }: LandingJsonLdProps) {
  const t = await getTranslations('LandingPage.faq');

  const faqItems = landingFaqConfig.map((config, i) => ({
    question: t(`items.${i}.question`),
    answer: buildFaqAnswerText(t, i, config.answerCount),
  }));

  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      name: 'Flexling',
      url: siteUrl,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: 'Flexling',
      url: siteUrl,
      applicationCategory: 'EducationalApplication',
      operatingSystem: 'Web, iOS, Android',
      description:
        'Learn languages your way with audio flashcards, spaced repetition, and AI-powered chat. Bring your own content, practice pronunciation, and build fluency fast.',
      offers: [
        {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'EUR',
          name: 'Free',
          description: 'Perfect for getting started',
        },
        {
          '@type': 'Offer',
          price: '8',
          priceCurrency: 'EUR',
          name: 'Basic',
          description: 'Everything you need to learn one language.',
        },
        {
          '@type': 'Offer',
          price: '16',
          priceCurrency: 'EUR',
          name: 'Pro',
          description: 'For maximum flexibility and polyglots.',
        },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: faqItems.map(({ question, answer }) => ({
        '@type': 'Question',
        name: question,
        acceptedAnswer: {
          '@type': 'Answer',
          text: answer,
        },
      })),
    },
  ];

  return (
    <>
      {jsonLd.map((schema, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
        />
      ))}
    </>
  );
}
