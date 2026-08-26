'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Switch } from '@/components/ui/switch';
import { setConsent, useConsentStatus } from '@/lib/posthog/consent';

/**
 * The preference centre. Reachable from the footer at any time, which is what
 * makes consent withdrawable. The privacy policy promises exactly this and,
 * before this component existed, nothing in the app could reopen the choice.
 */
export function ConsentSettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('Consent');
  const status = useConsentStatus();

  // Local mirror so toggling the switch feels immediate; the choice is only
  // committed on save, so opening the dialog to read it can't change anything.
  const [analytics, setAnalytics] = useState(status === 'granted');

  useEffect(() => {
    if (open) setAnalytics(status === 'granted');
  }, [open, status]);

  const handleSave = () => {
    setConsent(analytics);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        data-testid="consent-settings-dialog"
      >
        <DialogHeader>
          <DialogTitle className="heading-dialog">
            {t('settings.title')}
          </DialogTitle>
          <DialogDescription className="text-muted-sm">
            {t('settings.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="content-box space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium">
                {t('categories.necessary.title')}
              </span>
              {/* Locked on: without these the app cannot keep you signed in. */}
              <Switch checked disabled aria-readonly />
            </div>
            <p className="text-muted-xs">
              {t('categories.necessary.description')}
            </p>
          </div>

          <div className="content-box space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm font-medium">
                {t('categories.analytics.title')}
              </span>
              <Switch
                checked={analytics}
                onCheckedChange={setAnalytics}
                aria-label={t('categories.analytics.title')}
                data-testid="consent-toggle-analytics"
              />
            </div>
            <p className="text-muted-xs">
              {t('categories.analytics.description')}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={handleSave}
            className="w-full"
            data-testid="consent-settings-save"
          >
            {t('settings.save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
