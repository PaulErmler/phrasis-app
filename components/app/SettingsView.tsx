'use client';

import { useLayoutEffect, useRef, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { toast } from 'sonner';
import { usePreloadedQuery, useQuery } from 'convex/react';
import type { FunctionArgs } from 'convex/server';
import { api } from '@/convex/_generated/api';
import { reportError } from '@/lib/report-error';
import type { View } from '@/components/app/BottomNav';
import { Card, CardContent } from '@/components/ui/card';
import { LanguageSwitcher } from '@/components/LanguageSwitcher';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { authClient } from '@/lib/auth-client';
import { LogOut, Mail } from 'lucide-react';
import { Separator } from '@/components/ui/separator';
import PricingTable from '@/components/autumn/pricing-table';
import { useIsNativeApp } from '@/hooks/use-native-app';
import { DeleteAccountSection } from '@/components/app/DeleteAccountSection';
import { ChangePasswordSection } from '@/components/app/ChangePasswordSection';
import { useAppData } from '@/components/app/AppDataProvider';
import { useUpdateUserSettings } from '@/hooks/use-update-user-settings';

const SUPPORT_EMAIL = 'support@flexling.com';

function SettingsSectionHeading({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
      {children}
    </p>
  );
}

export function SettingsView({ activeView }: { activeView: View }) {
  const t = useTranslations('AppPage');
  const tFooter = useTranslations('Footer');
  const tAuth = useTranslations('Auth');
  const isNative = useIsNativeApp();
  const authUser = useQuery(api.auth.getAuthUser);
  const userEmail = (authUser as Record<string, unknown> | null | undefined)
    ?.email as string | undefined;
  const { preloadedSettings } = useAppData();
  const userSettings = usePreloadedQuery(preloadedSettings);
  const updateUserSettings = useUpdateUserSettings();

  // Every toggle below writes through here. `useUpdateUserSettings` registers
  // an optimistic patch, so a failed save has already rolled the switch back —
  // visibly snapping it — by the time the promise rejects. Without this the
  // rejection is unhandled and the user is told nothing, which is exactly the
  // silent-revert this app fixed for the course settings sheet.
  const setUserSetting = async (
    patch: FunctionArgs<typeof api.features.courses.updateUserSettings>,
  ) => {
    try {
      await updateUserSettings(patch);
    } catch (error) {
      reportError(error, { op: 'updateUserSettings' });
      toast.error(t('courses.manage.saveFailed'));
    }
  };

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
          {/* Language, account, UI settings */}
          <Card>
            <CardContent className="space-y-4">
              <SettingsSectionHeading>
                {t('settings.language')}
              </SettingsSectionHeading>
              <LanguageSwitcher />

              <Separator />

              <SettingsSectionHeading>
                {t('settings.account')}
              </SettingsSectionHeading>
              {userEmail && (
                <div className="flex items-center gap-2 p-3 surface-muted">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  {/* Hidden from session replay. Masking happens in the
                      browser, so the address never reaches PostHog. */}
                  <span className="text-sm" data-ph-mask>
                    {userEmail}
                  </span>
                </div>
              )}
              <ChangePasswordSection email={userEmail} />

              <Separator />

              <SettingsSectionHeading>
                {t('settings.uiSettings.title')}
              </SettingsSectionHeading>
              <div className="settings-row">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="showDueCounts"
                    className="text-sm font-medium"
                  >
                    {t('settings.uiSettings.showDueCounts')}
                  </Label>
                  <p className="text-muted-xs">
                    {t('settings.uiSettings.showDueCountsDescription')}
                  </p>
                </div>
                {/* Stored under the legacy "hide" field; only an explicit
                    `false` shows, so this Show switch writes the negation. */}
                <Switch
                  id="showDueCounts"
                  checked={userSettings?.hideDueCounts === false}
                  onCheckedChange={(checked) => {
                    void setUserSetting({ hideDueCounts: !checked });
                  }}
                  className="mt-0.5"
                />
              </div>
              <div className="settings-row">
                <div className="space-y-0.5">
                  <Label
                    htmlFor="showWorkloadForecast"
                    className="text-sm font-medium"
                  >
                    {t('settings.uiSettings.showWorkloadForecast')}
                  </Label>
                  <p className="text-muted-xs">
                    {t('settings.uiSettings.showWorkloadForecastDescription')}
                  </p>
                </div>
                <Switch
                  id="showWorkloadForecast"
                  checked={userSettings?.hideWorkloadForecast === false}
                  onCheckedChange={(checked) => {
                    void setUserSetting({ hideWorkloadForecast: !checked });
                  }}
                  className="mt-0.5"
                />
              </div>
            </CardContent>
          </Card>

          {/* Plans are not shown in the store-app shell (store payment
              policies), PricingTable also self-hides, this just keeps an
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
            <CardContent className="space-y-4">
              <SettingsSectionHeading>
                {t('settings.contactPrompt.title')}
              </SettingsSectionHeading>
              <p className="text-muted-xs">
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

              <Separator />

              <SettingsSectionHeading>
                {t('settings.legal.label')}
              </SettingsSectionHeading>
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

          {/* Attribution footer, deliberately below everything else. */}
          <p className="px-2 pb-2 text-xs text-muted-foreground text-center">
            {t.rich('settings.attribution.text', {
              tatoeba: (chunks) => (
                <a
                  href="http://tatoeba.org/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
                  {chunks}
                </a>
              ),
              ccby: (chunks) => (
                <a
                  href="http://creativecommons.org/licenses/by/2.0/fr/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground"
                >
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
