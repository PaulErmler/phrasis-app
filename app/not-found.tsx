import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

export default async function NotFound() {
  const t = await getTranslations('NotFoundPage');

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center">
      <div className="space-y-2">
        <h1 className="text-6xl font-bold text-primary">404</h1>
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <p className="text-muted-foreground max-w-md">
          {t('description')}
        </p>
      </div>
      <Link
        href="/"
        className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
      >
        {t('goHome')}
      </Link>
    </div>
  );
}
