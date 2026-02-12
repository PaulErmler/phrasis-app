'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ArrowRight } from 'lucide-react';

interface GoToAppButtonProps {
  isAuthenticated: boolean;
  userName?: string | null;
}

export function GoToAppButton({ isAuthenticated }: GoToAppButtonProps) {
  const router = useRouter();
  const t = useTranslations('HomePage');

  if (isAuthenticated) {
    return (
      <Card className="border-border/50 shadow-xl shadow-black/5">
        <CardHeader className="space-y-1 pb-4">
          <CardTitle className="text-xl font-semibold text-center">
            {t('welcomeBack')}
          </CardTitle>
          <CardDescription className="text-center">
            {t('continueToApp')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => router.push('/app')}
            className="w-full bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25 transition-all duration-200"
            size="lg"
          >
            {t('goToApp')}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  // If not authenticated, show sign up prompt
  return (
    <Card className="border-border/50 shadow-xl shadow-black/5">
      <CardHeader className="space-y-1 pb-4">
        <CardTitle className="text-xl font-semibold text-center">
          {t('authCard.startLearning')}
        </CardTitle>
        <CardDescription className="text-center">
          {t('authCard.createAccount')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button
          onClick={() => router.push('/auth/sign-up')}
          className="w-full bg-linear-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white shadow-lg shadow-emerald-500/25 transition-all duration-200"
          size="lg"
        >
          {t('getStarted')}
          <ArrowRight className="ml-2 h-4 w-4" />
        </Button>
        <Button
          onClick={() => router.push('/auth/sign-in')}
          variant="outline"
          className="w-full"
          size="lg"
        >
          {t('signIn')}
        </Button>
      </CardContent>
    </Card>
  );
}
