import type { ReactNode } from 'react';
import { ScopedMessages } from '@/components/i18n/ScopedMessages';
import {
  APP_NAMESPACES,
  ONBOARDING_NAMESPACES,
  SHARED_NAMESPACES,
} from '@/i18n/namespaces';

/**
 * Adds the onboarding-only namespaces on top of the app set (nested
 * providers replace, not merge — the list must be self-sufficient). Keeps
 * OnboardingTutorial strings out of every normal app tab.
 */
export default function OnboardingLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <ScopedMessages
      namespaces={[
        ...SHARED_NAMESPACES,
        ...APP_NAMESPACES,
        ...ONBOARDING_NAMESPACES,
      ]}
    >
      {children}
    </ScopedMessages>
  );
}
