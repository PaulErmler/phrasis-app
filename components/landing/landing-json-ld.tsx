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
        'Learn a language the way you learned your first. Absorb words in sentences that actually matter to you — type them, import them, or ask AI to create cards.',
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
          price: '72',
          priceCurrency: 'EUR',
          name: 'Basic Annual',
          description:
            'Everything you need to learn one language, billed annually.',
        },
        {
          '@type': 'Offer',
          price: '16',
          priceCurrency: 'EUR',
          name: 'Pro',
          description: 'Everything you need to learn multiple languages.',
        },
        {
          '@type': 'Offer',
          price: '144',
          priceCurrency: 'EUR',
          name: 'Pro Annual',
          description:
            'Everything you need to learn multiple languages, billed annually.',
        },
        {
          '@type': 'Offer',
          price: '32',
          priceCurrency: 'EUR',
          name: 'Ultra',
          description: 'Maximum customization and AI features.',
        },
        {
          '@type': 'Offer',
          price: '288',
          priceCurrency: 'EUR',
          name: 'Ultra Annual',
          description:
            'Maximum customization and AI features, billed annually.',
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
