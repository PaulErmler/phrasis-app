import type { Metadata } from 'next';
import { OnboardingPreview } from './OnboardingPreview';

/**
 * Onboarding prototype viewer, at /dev/onboarding-preview.
 *
 * Renders the real onboarding wizard (app/app/onboarding/OnboardingWizard.tsx)
 * with in-memory handlers, so the flow can be looked at and clicked through
 * without signing up again: no session, nothing written to the backend, the
 * finish just toasts where it would navigate.
 *
 * Local development only: app/dev/layout.tsx returns 404 for anything but
 * `next dev`.
 */

export const metadata: Metadata = {
  title: 'Onboarding preview',
};

export default function OnboardingPreviewPage() {
  return <OnboardingPreview />;
}
