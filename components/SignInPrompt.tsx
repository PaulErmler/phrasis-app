import Link from 'next/link';
import { getTranslations } from 'next-intl/server';
import { Button } from '@/components/ui/button';
import { LogoSpinner } from '@/components/LogoSpinner';

export async function SignInPrompt() {
  const t = await getTranslations('SignInPrompt');

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="flex flex-col items-center gap-6 text-center max-w-sm">
        <LogoSpinner />
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Button asChild size="lg">
          <Link href="/auth/sign-in">{t('signInButton')}</Link>
        </Button>
      </div>
    </main>
  );
}
