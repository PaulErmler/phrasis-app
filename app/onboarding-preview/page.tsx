import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { OnboardingPreview } from './OnboardingPreview';

/**
 * Onboarding prototype viewer. Not linked from the app.
 *
 * Renders the real onboarding wizard (app/app/onboarding/OnboardingWizard.tsx)
 * with in-memory handlers, so the flow can be looked at and clicked through
 * without signing up again: no session, nothing written to the backend, the
 * finish just toasts where it would navigate.
 *
 * Dev-only: hidden in production unless ENABLE_STORE_SCREENS=1 is set at
 * build time (the same switch as app/screenshots and app/store-frames), and
 * always noindexed.
 */

export const metadata: Metadata = {
  title: 'Onboarding preview',
  robots: { index: false, follow: false },
};

export default function OnboardingPreviewPage() {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ENABLE_STORE_SCREENS !== '1'
  ) {
    notFound();
  }
  return <OnboardingPreview />;
}
