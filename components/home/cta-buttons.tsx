'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

interface CTAButtonsProps {
  isAuthenticated: boolean;
}

export function CTAButtons({ isAuthenticated }: CTAButtonsProps) {
  const router = useRouter();
  const t = useTranslations('HomePage');

  if (isAuthenticated) {
    return (
      <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
        <Button
          onClick={() => router.push('/app')}
          size="lg"
          className="w-full sm:w-auto min-w-[200px] text-base h-12 bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25"
        >
          {t('goToApp')}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row items-center justify-center gap-4 pt-4">
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
        className="w-full sm:w-auto min-w-[160px] text-base h-12 bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25"
      >
        {t('getStarted')}
      </Button>
    </div>
  );
}
