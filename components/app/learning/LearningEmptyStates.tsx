'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';

// ============================================================================
// No collection selected
// ============================================================================

interface NoCollectionStateProps {
  onGoHome: () => void;
}

export function NoCollectionState({ onGoHome }: NoCollectionStateProps) {
  const t = useTranslations('LearningMode');

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
      <p className="text-muted-sm text-center">{t('empty.noCollection')}</p>
      <Button onClick={onGoHome}>{t('empty.goHome')}</Button>
    </main>
  );
}

// ============================================================================
// No cards due
// ============================================================================

interface NoCardsDueStateProps {
  onAddCards: () => void;
  isAddingCards: boolean;
  batchSize: number;
}

export function NoCardsDueState({
  onAddCards,
  isAddingCards,
  batchSize,
}: NoCardsDueStateProps) {
  const t = useTranslations('LearningMode');

  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-6 px-4">
      <div className="text-center space-y-2">
        <p className="body-large font-medium">{t('empty.noCardsDue')}</p>
        <p className="text-muted-sm">{t('empty.allDone')}</p>
      </div>
      <Button
        size="lg"
        onClick={onAddCards}
        disabled={isAddingCards}
        className="gap-2"
      >
        {isAddingCards ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('empty.adding')}
          </>
        ) : (
          t('empty.addCards', { count: batchSize })
        )}
      </Button>
    </main>
  );
}
