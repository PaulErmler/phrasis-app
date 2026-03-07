'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { BookOpen, Headphones } from 'lucide-react';

type ReviewMode = 'audio' | 'full';

interface StartLearningButtonProps {
  onStartReview: (mode: ReviewMode) => void;
}

export function StartLearningButton({ onStartReview }: StartLearningButtonProps) {
  const t = useTranslations('AppPage');

  return (
    <div className="grid grid-cols-2 gap-2">
      <Button
        size="lg"
        className="w-full gap-2"
        onClick={() => onStartReview('full')}
      >
        <BookOpen className="h-5 w-5" />
        {t('fullReview')}
      </Button>
      <Button
        size="lg"
        className="w-full gap-2"
        onClick={() => onStartReview('audio')}
      >
        <Headphones className="h-5 w-5" />
        {t('audioReview')}
      </Button>
    </div>
  );
}
