import { getTranslations } from 'next-intl/server';
import Link from 'next/link';
import { FooterControls } from '@/components/landing/footer-controls';
import { ConsentSettingsLink } from '@/components/consent/ConsentSettingsLink';

export async function Footer() {
  const t = await getTranslations('Footer');

  return (
    <footer className="w-full border-t border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
            <Link
              href="/legal/impressum"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('legal.impressum')}
            </Link>
            <span className="text-muted-foreground">•</span>
            <Link
              href="/legal/agb"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('legal.agb')}
            </Link>
            <span className="text-muted-foreground">•</span>
            <Link
              href="/legal/privacy"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              {t('legal.privacy')}
            </Link>
            <span className="text-muted-foreground">•</span>
            {/* The withdrawal mechanism the privacy policy promises. */}
            <ConsentSettingsLink />
          </div>

          <FooterControls />
        </div>
      </div>
    </footer>
  );
}
