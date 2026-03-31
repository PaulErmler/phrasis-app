'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';

export function LandingFooter() {
  const t = useTranslations('Footer');
  const tHeader = useTranslations('LandingPage.header');

  return (
      <footer className="w-full border-t border-border bg-background">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-14 md:py-20">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 lg:gap-8">
            {/* Column 1: Brand */}
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <img
                  src="/icons/icon.svg"
                  alt="Flexling"
                  className="w-8 h-8"
                  width={32}
                  height={32}
                />
                <h3 className="text-2xl font-bold text-primary">
                  Flexling
                </h3>
              </div>
              <p className="text-sm text-muted-foreground">
                The language app that grows with you.
              </p>
            </div>

            {/* Column 2: Product */}
            <div className="space-y-4">
              <h4 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
                Product
              </h4>
              <ul className="space-y-2.5 text-sm">
                <li>
                  <a
                    href="#philosophy"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {tHeader('nav.howItWorks')}
                  </a>
                </li>
                <li>
                  <a
                    href="#features"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {tHeader('nav.features')}
                  </a>
                </li>
                <li>
                  <a
                    href="#pricing"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {tHeader('nav.pricing')}
                  </a>
                </li>
                <li>
                  <a
                    href="#faq"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {tHeader('nav.faq')}
                  </a>
                </li>
              </ul>
            </div>

            {/* Column 3: Legal */}
            <div className="space-y-4">
              <h4 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
                Legal
              </h4>
              <ul className="space-y-2.5 text-sm">
                <li>
                  <Link
                    href="/legal/impressum"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t('legal.impressum')}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/legal/agb"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t('legal.agb')}
                  </Link>
                </li>
                <li>
                  <Link
                    href="/legal/privacy"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {t('legal.privacy')}
                  </Link>
                </li>
              </ul>
            </div>

            {/* Column 4: Settings */}
            <div className="space-y-4">
              <h4 className="text-xs font-semibold tracking-widest uppercase text-muted-foreground/70">
                Settings
              </h4>
              <p className="text-sm text-muted-foreground">
                {t('madeInGermany')} 🇩🇪
              </p>
              <div className="flex items-center gap-2">
                <LanguageSwitcher compact />
                <ThemeSwitcher />
              </div>
            </div>
          </div>

          {/* Bottom copyright */}
          <div className="mt-12 pt-8 border-t border-border text-center">
            <p className="text-sm text-muted-foreground/70">
              &copy; {new Date().getFullYear()} Flexling.
            </p>
          </div>
        </div>
      </footer>
  );
}
