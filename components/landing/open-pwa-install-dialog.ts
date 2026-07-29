'use client';

import { CLIENT_EVENTS, capture } from '@/lib/posthog/events';

export function openPwaInstallDialog() {
  const el = document.querySelector('pwa-install') as
    | (HTMLElement & { showDialog: () => void })
    | null;
  // The prompt half of the install funnel; the outcome half is the
  // `appinstalled` listener in PWAInstallGlobal (Chromium-only).
  capture(CLIENT_EVENTS.PWA_INSTALL_PROMPTED, { available: el !== null });
  el?.showDialog();
}
