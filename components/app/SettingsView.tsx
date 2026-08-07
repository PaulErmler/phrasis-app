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
import { useIsNativeApp } from '@/hooks/use-native-app';
import { DeleteAccountSection } from '@/components/app/DeleteAccountSection';
import { ChangePasswordSection } from '@/components/app/ChangePasswordSection';

const SUPPORT_EMAIL = 'support@flexling.com';

export function SettingsView({ activeView }: { activeView: View }) {
  const t = useTranslations('AppPage');
  const tFooter = useTranslations('Footer');
  const tAuth = useTranslations('Auth');
  const isNative = useIsNativeApp();
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
        <div className="space-y-4">
          {/* Language + account */}
          <Card>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <label className="label-form">{t('settings.language')}</label>
                <LanguageSwitcher />
              </div>

              <Separator />

              <div className="space-y-4">
                <label className="label-form">{t('settings.account')}</label>
                {userEmail && (
                  <div className="flex items-center gap-2 p-3 surface-muted">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    {/* Hidden from session replay — masking happens in the
                        browser, so the address never reaches PostHog. */}
                    <span className="text-sm" data-ph-mask>
                      {userEmail}
                    </span>
                  </div>
                )}
                <ChangePasswordSection email={userEmail} />
              </div>
            </CardContent>
          </Card>

          {/* Plans are not shown in the store-app shell (store payment
              policies) — PricingTable also self-hides, this just keeps an
              empty card from rendering. */}
          {!isNative && (
            <Card>
              <CardContent>
                <PricingTable />
              </CardContent>
            </Card>
          )}

          {/* Support & legal */}
          <Card>
            <CardContent className="space-y-6">
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
            </CardContent>
          </Card>

          {/* Sign out / delete */}
          <Card>
            <CardContent className="space-y-2">
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
              <DeleteAccountSection />
            </CardContent>
          </Card>

          {/* Attribution footer — deliberately below everything else. */}
          <p className="px-2 pb-2 text-xs text-muted-foreground text-center">
            {t.rich('settings.attribution.text', {
              tatoeba: (chunks) => (
                <a href="http://tatoeba.org/" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                  {chunks}
                </a>
              ),
              ccby: (chunks) => (
                <a href="http://creativecommons.org/licenses/by/2.0/fr/" target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">
                  {chunks}
                </a>
              ),
            })}
          </p>
        </div>
      </div>
    </div>
  );
}
