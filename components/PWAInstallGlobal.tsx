'use client';

import '@khmyznikov/pwa-install';

/**
 * Global PWA Install element that should be rendered once at the root level.
 * This element is hidden and will show a dialog when triggered by PWAInstallButton.
 */
export function PWAInstallGlobal() {
  return (
    <pwa-install
      manual-apple="true"
      manual-chrome="true"
      manifest-url="/manifest.json"
    ></pwa-install>
  );
}
