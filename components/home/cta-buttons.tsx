'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import '@khmyznikov/pwa-install';

interface CTAButtonsProps {
  isAuthenticated: boolean;
}

export function CTAButtons({ isAuthenticated }: CTAButtonsProps) {
  const router = useRouter();
  const t = useTranslations('HomePage');
  const pwaInstallRef = useRef<
    (HTMLElement & { showDialog: () => void }) | null
      >(null);

  useEffect(() => {
    // Get reference to the pwa-install element
    const pwaInstallElement = document.querySelector('pwa-install') as
      | (HTMLElement & {
          showDialog: () => void;
        })
      | null;

    if (pwaInstallElement) {
      pwaInstallRef.current = pwaInstallElement;
    }
  }, []);

  const handleInstallClick = () => {
    if (pwaInstallRef.current) {
      pwaInstallRef.current.showDialog();
    }
  };

  if (isAuthenticated) {
    return (
      <>
        {/* Hidden pwa-install element */}
        <pwa-install
          manual-apple="true"
          manual-chrome="true"
          manifest-url="/manifest.json"
        ></pwa-install>

        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
          <Button
            onClick={() => router.push('/app')}
            size="lg"
            className="w-full sm:w-auto min-w-[200px] text-base h-12 shadow-xl shadow-black/5"
          >
            {t('goToApp')}
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {/* Hidden pwa-install element */}
      <pwa-install
        manual-apple="true"
        manual-chrome="true"
        manifest-url="/manifest.json"
      ></pwa-install>

      <div className="flex flex-col items-center justify-center gap-4 pt-4">
        {/* First row: Sign In and Get Started */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4 w-full">
          <Button
            onClick={() => router.push('/auth/sign-in')}
            size="lg"
            variant="outline"
            className="w-full sm:w-auto min-w-[160px] text-base h-12"
          >
            {t('signIn')}
          </Button>
          <Button
            onClick={() => router.push('/auth/sign-up')}
            size="lg"
            className="w-full sm:w-auto min-w-[160px] text-base h-12 shadow-xl shadow-black/5"
          >
            {t('getStarted')}
          </Button>
        </div>

        {/* Second row: Install App button */}
        <Button
          onClick={handleInstallClick}
          variant="outline"
          size="lg"
          className="w-full sm:w-[336px] text-base h-12"
        >
          {t('installApp')}
        </Button>
      </div>
    </>
  );
}
