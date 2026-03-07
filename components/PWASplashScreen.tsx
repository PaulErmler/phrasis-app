'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { Loader2Icon } from 'lucide-react';

export function PWASplashScreen() {
  const [visible, setVisible] = useState(false);
  const [fadeOut, setFadeOut] = useState(false);

  useEffect(() => {
    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true;
    const alreadyShown = sessionStorage.getItem('pwa-splash-shown');

    if (!isStandalone || alreadyShown) return;

    setVisible(true);
    sessionStorage.setItem('pwa-splash-shown', '1');

    function dismiss() {
      setFadeOut(true);
    }

    if (document.readyState === 'complete') {
      const timer = setTimeout(dismiss, 300);
      return () => clearTimeout(timer);
    }

    window.addEventListener('load', dismiss);
    return () => window.removeEventListener('load', dismiss);
  }, []);

  if (!visible) return null;

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-[#0d1117] transition-opacity duration-500 ${fadeOut ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      onTransitionEnd={() => {
        if (fadeOut) setVisible(false);
      }}
    >
      <Image
        src="/icons/icon.svg"
        alt="Cacatua"
        width={96}
        height={96}
        priority
      />
      <p className="mt-4 text-lg font-semibold text-white">Cacatua</p>
      <Loader2Icon className="mt-6 size-6 animate-spin text-white/60" />
    </div>
  );
}
