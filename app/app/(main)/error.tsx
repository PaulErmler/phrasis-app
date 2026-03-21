'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations('ErrorPage');

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <p className="text-muted-foreground max-w-md">
          {t('description')}
        </p>
      </div>
      <button
        onClick={reset}
        className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t('retry')}
      </button>
    </div>
  );
}
