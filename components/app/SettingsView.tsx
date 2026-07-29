'use client';

import { useLayoutEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { View } from '@/components/app/BottomNav';
import { Card, CardContent } from '@/components/ui/card';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { LogOut, Mail } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import PricingTable from '@/components/autumn/pricing-table';

const SUPPORT_EMAIL = 'support@flexling.com';

export function SettingsView({ activeView }: { activeView: View }) {
  const t = useTranslations('AppPage');
  const tFooter = useTranslations('Footer');
  const tAuth = useTranslations('Auth');
  const authUser = useQuery(api.auth.getAuthUser);
  const userEmail = (authUser as Record<string, unknown> | null | undefined)?.email as string | undefined;

  const scrollRef = useRef<HTMLDivElement>(null);
  const prevViewRef = useRef<View | null>(null);

  useLayoutEffect(() => {
    if (
      activeView === 'settings' &&
      prevViewRef.current !== 'settings' &&
      scrollRef.current
    ) {
      scrollRef.current.scrollTop = 0;
    }
    prevViewRef.current = activeView;
  }, [activeView]);

  return (
    <div
      ref={scrollRef}
      className="scroll-view"
      style={{ scrollbarGutter: 'stable' }}
    >
      <div className="app-view">
        <Card>
          <CardContent className="space-y-6">
            {/* User Email Section */}
            {userEmail && (
              <div className="space-y-2">
                <label className="label-form">
                  {t('settings.account')}
                </label>
                <div className="flex items-center gap-2 p-3 surface-muted">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  {/* Hidden from session replay — masking happens in the
                      browser, so the address never reaches PostHog. */}
                  <span className="text-sm" data-ph-mask>
                    {userEmail}
                  </span>
                </div>
              </div>
            )}

            <Separator />

            {/* Language Section */}
            <div className="space-y-2">
              <label className="label-form">
                {t('settings.language')}
              </label>
              <LanguageSwitcher />
            </div>

            <Separator/> 

            <PricingTable />

            <Separator />

            <div className="space-y-3">
              <label className="label-form">
                {t('settings.contactPrompt.title')}
              </label>
              <p className="text-sm text-muted-foreground">
                {t('settings.contactPrompt.description')}
              </p>
              <Button variant="outline" className="w-full sm:w-auto" asChild>
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(t('settings.contactPrompt.emailSubject'))}`}
                >
                  <Mail className="h-4 w-4" />
                  {t('help.contactUs')}
                </a>
              </Button>
            </div>

            <Separator />

            {/* Legal */}
            <div className="space-y-2">
              <label className="label-form">{t('settings.legal.label')}</label>
              <nav
                className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground"
                aria-label={t('settings.legal.label')}
              >
                <Link
                  href="/legal/impressum"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {tFooter('legal.impressum')}
                </Link>
                <span aria-hidden>•</span>
                <Link
                  href="/legal/agb"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {tFooter('legal.agb')}
                </Link>
                <span aria-hidden>•</span>
                <Link
                  href="/legal/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  {tFooter('legal.privacy')}
                </Link>
              </nav>
            </div>

            <Separator />

            {/* Attribution Section */}
            <div className="space-y-2">
              <label className="label-form">
                {t('settings.attribution.label')}
              </label>
              <p className="text-sm text-muted-foreground">
                {t.rich('settings.attribution.text', {
                  tatoeba: (chunks) => (
                    <a href="http://tatoeba.org/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {chunks}
                    </a>
                  ),
                  ccby: (chunks) => (
                    <a href="http://creativecommons.org/licenses/by/2.0/fr/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                      {chunks}
                    </a>
                  ),
                })}
              </p>
            </div>

            <Separator />

            {/* Sign Out Section */}
            <div className="space-y-2">
              <Button
                variant="destructive"
                className="w-full"
                onClick={() =>
                  authClient.signOut({
                    fetchOptions: {
                      onSuccess: () => {
                        window.location.href = '/';
                      },
                    },
                  })
                }
              >
                <LogOut className="h-4 w-4 mr-2" />
                {tAuth('SIGN_OUT')}
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
