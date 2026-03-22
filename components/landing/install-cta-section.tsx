import { getTranslations } from 'next-intl/server';
import { Download } from 'lucide-react';
import { PwaInstallTrigger } from './pwa-install-button';

export async function InstallCtaSection() {
  const t = await getTranslations('LandingPage.installCta');

  return (
    <section className="relative py-20 md:py-28 px-4 install-cta-gradient">
      <div className="max-w-3xl mx-auto text-center">
        <img
          src="/icons/icon.svg"
          alt="Flexling language learning app logo"
          className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-8"
          width={80}
          height={80}
        />

        <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold tracking-tight mb-6">
          {t('title')}
        </h2>

        <p className="text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
          {t('subtitle')}
        </p>

        <PwaInstallTrigger
          size="lg"
          className="text-lg h-14 px-10 shadow-xl shadow-primary/20"
        >
          <Download className="mr-2 h-5 w-5" />
          {t('button')}
        </PwaInstallTrigger>

        <p className="text-sm text-muted-foreground/60 mt-4">{t('note')}</p>
      </div>
    </section>
  );
}
