'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { denyConsent, grantConsent, useConsentStatus } from '@/lib/posthog/consent';
import { ConsentSettingsDialog } from './ConsentSettingsDialog';

/**
 * Cookie banner. Only rendered while PostHog reports 'pending', i.e. before the
 * user has made an explicit choice. Until then PostHog writes nothing to the
 * device, so there is no "we already set cookies, please confirm" problem.
 *
 * Accept and Reject deliberately share a size and weight: a reject button that
 * is visually quieter than accept is the single most common way consent banners
 * fail an audit.
 */
export function ConsentBanner() {
  const t = useTranslations('Consent');
  const status = useConsentStatus();
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (status !== 'pending') return null;

  return (
    <>
      <div
        // Bottom padding clears the iOS home indicator; the root layout already
        // opts into `viewport-fit=cover`. Same safe-area inset the BottomNav
        // uses, floored at the normal padding so it never collapses.
        className="fixed inset-x-0 bottom-0 z-100 p-4 pb-[max(1rem,var(--safe-bottom))]"
        role="dialog"
        aria-modal="false"
        aria-label={t('banner.title')}
        data-testid="consent-banner"
      >
        <div className="card-surface mx-auto max-w-xl space-y-4 p-4">
          <div className="space-y-2">
            <p className="heading-section">{t('banner.title')}</p>
            <p className="text-muted-sm">
              {t('banner.description')}{' '}
              <Link
                href="/legal/privacy"
                className="underline underline-offset-4 hover:text-foreground"
              >
                {t('banner.privacyLink')}
              </Link>
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              onClick={grantConsent}
              className="w-full sm:flex-1"
              data-testid="consent-accept"
            >
              {t('banner.accept')}
            </Button>
            <Button
              variant="outline"
              onClick={denyConsent}
              className="w-full sm:flex-1"
              data-testid="consent-reject"
            >
              {t('banner.reject')}
            </Button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSettingsOpen(true)}
            className="w-full"
            data-testid="consent-customize"
          >
            {t('banner.customize')}
          </Button>
        </div>
      </div>

      <ConsentSettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
