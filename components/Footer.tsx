"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeSwitcher } from "@/components/ThemeSwitcher";

export function Footer() {
  const t = useTranslations("Footer");

  return (
    <footer className="w-full border-t border-border bg-background/95 backdrop-blur supports-backdrop-filter:bg-background/60">
      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col gap-4">
          {/* Top Row - Legal Links and Made in Germany */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex flex-wrap items-center justify-center gap-4 text-sm">
              <Link 
                href="/legal/impressum" 
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("legal.impressum")}
              </Link>
              <span className="text-muted-foreground">•</span>
              <Link 
                href="/legal/agb" 
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("legal.agb")}
              </Link>
              <span className="text-muted-foreground">•</span>
              <Link 
                href="/legal/privacy" 
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {t("legal.privacy")}
              </Link>
            </div>
            
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>🇩🇪</span>
              <span>{t("madeInGermany")}</span>
            </div>
          </div>

          {/* Bottom Row - Language and Theme Selectors */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-2 border-t border-border/50">
            <div className="flex items-center gap-4">
              <div className="w-[140px]">
                <LanguageSwitcher />
              </div>
              <ThemeSwitcher />
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
