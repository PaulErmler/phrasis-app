import { getTranslations } from 'next-intl/server';
import { PhilosophyPillarsClient, type PhilosophyPillar } from './philosophy-pillars-client';

function PhilosophyHeading({ title, titleHighlight }: { title: string; titleHighlight: string }) {
  const highlight = titleHighlight.trim();
  return (
    <>
      {title}
      {highlight ? (
        <>
          {' '}
          <span className="gradient-text">{highlight}</span>
        </>
      ) : null}
    </>
  );
}

export async function PhilosophySection() {
  const t = await getTranslations('LandingPage.philosophy');
  const title = t('title');
  const titleHighlight = t('titleHighlight');

  const pillars: [PhilosophyPillar, PhilosophyPillar, PhilosophyPillar] = [
    { title: t('pillar1Title'), body: t('pillar1Body') },
    { title: t('pillar2Title'), body: t('pillar2Body') },
    { title: t('pillar3Title'), body: t('pillar3Body') },
  ];

  return (
    <section
      id="philosophy"
      className="relative py-16 md:py-24 px-4 border-t border-border/60 bg-muted/10 max-md:z-[2] max-md:isolate md:z-auto"
    >
      <div className="max-w-7xl mx-auto">
        <div className="hidden md:block max-w-3xl mx-auto text-center space-y-5 mb-10 md:mb-14">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-tight text-foreground">
            <PhilosophyHeading title={title} titleHighlight={titleHighlight} />
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
            {t('lead')}
          </p>
        </div>

        <PhilosophyPillarsClient
          pillars={pillars}
          title={<PhilosophyHeading title={title} titleHighlight={titleHighlight} />}
          lead={t('lead')}
        />
      </div>
    </section>
  );
}
