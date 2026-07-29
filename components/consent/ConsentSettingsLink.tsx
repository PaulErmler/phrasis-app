'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import { ConsentSettingsDialog } from './ConsentSettingsDialog';

/**
 * Footer entry point to the preference centre. Rendered unconditionally, not
 * only after a choice has been made: GDPR requires withdrawing consent to be as
 * easy as giving it, and a link that appears and disappears is not that.
 */
export function ConsentSettingsLink() {
  const t = useTranslations('Consent');
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground transition-colors"
        data-testid="footer-consent-settings"
      >
        {t('footerLink')}
      </button>
      <ConsentSettingsDialog open={open} onOpenChange={setOpen} />
    </>
  );
}
