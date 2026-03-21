'use client';

export function openPwaInstallDialog() {
  const el = document.querySelector('pwa-install') as
    | (HTMLElement & { showDialog: () => void })
    | null;
  el?.showDialog();
}
