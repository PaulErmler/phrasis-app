import { Heart, ExternalLink } from "lucide-react";
import { useTranslations } from "next-intl";

export function DonationSection() {
  const t = useTranslations('LandingPage.donation');
  return (
    <section id="donate" className="relative py-12 md:py-16 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="rounded-2xl border border-border/50 bg-gradient-to-br from-accent-orange/5 to-primary/5 p-8 md:p-12 text-center shadow-lg">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-accent-orange/10 mb-6 animate-pulse-glow-orange">
            <Heart className="w-8 h-8 text-accent-orange fill-accent-orange/20" />
          </div>
          
          <h2 className="text-2xl md:text-3xl font-bold mb-4">
            {t('title')} <span className="gradient-text">{t('titleHighlight')}</span>
          </h2>
          
          <p className="text-base md:text-lg text-muted-foreground max-w-2xl mx-auto mb-6">
            {t('description')} <span className="font-semibold text-foreground">{t('percentage')}</span> {t('description2')} {" "}
            <a
              href="https://www.givewell.org"
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline inline-flex items-center gap-1 font-medium"
            >
              {t('givewellLink')}
              <ExternalLink className="w-4 h-4" />
            </a>. 
          </p>
        </div>
      </div>
    </section>
  );
}

