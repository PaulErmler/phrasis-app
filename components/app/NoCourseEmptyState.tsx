'use client';

import { useTranslations } from 'next-intl';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function NoCourseEmptyState({
  onOpenCourseMenu,
}: {
  onOpenCourseMenu: () => void;
}) {
  const t = useTranslations('AppPage.noCourse');

  return (
    <div className="app-view flex flex-col items-center justify-center py-20 text-center">
      <div className="p-4 rounded-full bg-muted mb-4">
        <BookOpen className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="text-lg font-semibold mb-1">{t('title')}</h2>
      <p className="text-muted-sm mb-6 max-w-xs">{t('description')}</p>
      <Button onClick={onOpenCourseMenu}>{t('action')}</Button>
    </div>
  );
}
