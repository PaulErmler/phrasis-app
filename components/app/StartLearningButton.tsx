'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Play, Loader2 } from 'lucide-react';

export function StartLearningButton({
  onStartLearning,
  isNavigating,
}: {
  onStartLearning: () => void;
  isNavigating: boolean;
}) {
  const t = useTranslations('AppPage');

  return (
    <Button
      size="lg"
      className="w-full gap-2"
      onClick={onStartLearning}
      disabled={isNavigating}
    >
      {isNavigating ? (
        <Loader2 className="h-5 w-5 animate-spin" />
      ) : (
        <Play className="h-5 w-5 fill-current" />
      )}
      {t('startLearning')}
    </Button>
  );
}
