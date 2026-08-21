'use client';

import { useEffect } from 'react';

import '@khmyznikov/pwa-install';
import { useIsNativeApp } from '@/hooks/use-native-app';

import { CLIENT_EVENTS, capture } from '@/lib/posthog/events';

/**
 * Global PWA Install element that should be rendered once at the root level.
 * This element is hidden and will show a dialog when triggered by PWAInstallButton.
 */
export function PWAInstallGlobal() {
  // Store-app shell: nothing to install (and no install to track).
  const isNative = useIsNativeApp();

  useEffect(() => {
    if (isNative) return;
    // The install *outcome* is observable after all: Chromium fires
    // `appinstalled` on window regardless of where the install started (our
    // dialog, the omnibox icon, the browser menu). Pairs with
    // `pwa_install_prompted` to give the dialog a conversion rate. iOS never
    // fires it. Safari installs stay invisible, which is a platform limit.
    const onInstalled = () => capture(CLIENT_EVENTS.PWA_INSTALLED);
    window.addEventListener('appinstalled', onInstalled);
    return () => window.removeEventListener('appinstalled', onInstalled);
  }, [isNative]);

  if (isNative) return null;
  return (
    <pwa-install
      manual-apple="true"
      manual-chrome="true"
      manifest-url="/manifest.json"
    ></pwa-install>
  );
}
