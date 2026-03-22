'use client';

import { useMemo } from 'react';
import { diffChars } from 'diff';
import { useTranslations } from 'next-intl';

interface DiffDisplayProps {
  expected: string;
  actual: string;
  hideAccuracy?: boolean;
  hideErrors?: boolean;
}

function computeAccuracyFromChanges(changes: ReturnType<typeof diffChars>): number {
  let matchingChars = 0;
  let totalChars = 0;

  for (const change of changes) {
    const len = change.value.length;
    if (!change.added && !change.removed) {
      matchingChars += len;
    }
    totalChars += len;
  }

  if (totalChars === 0) return 100;
  return Math.round((matchingChars / totalChars) * 100);
}

export function DiffDisplay({ expected, actual, hideAccuracy = false, hideErrors = false }: DiffDisplayProps) {
  const t = useTranslations('LearningMode');

  const { changes, accuracy } = useMemo(() => {
    const changes = diffChars(expected, actual);
    const accuracy = computeAccuracyFromChanges(changes);
    return { changes, accuracy };
  }, [expected, actual]);

  return (
    <div>
      <p className="leading-relaxed">
        {changes.map((change, i) => {
          if (change.added) {
            if (hideErrors) return null;
            return (
              <span
                key={i}
                className="bg-destructive/15 text-destructive rounded-sm px-0.5"
              >
                {change.value}
              </span>
            );
          }
          if (change.removed) {
            return (
              <span
                key={i}
                className={hideErrors ? 'text-foreground' : 'text-foreground bg-muted rounded-sm px-0.5'}
              >
                {change.value}
              </span>
            );
          }
          return (
            <span key={i} className={hideErrors ? 'text-foreground' : 'bg-success/15 text-success rounded-sm px-0.5'}>
              {change.value}
            </span>
          );
        })}
      </p>
      <p className={`text-muted-xs mt-2 ${hideAccuracy ? 'invisible' : ''}`}>
        {t('accuracy')}: {accuracy}%
      </p>
    </div>
  );
}
