'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  PreviewSentenceRows,
  cefrForOgte,
  clampOgte,
} from '@/components/course/LevelPicker';
import { useCourseLanguages } from '@/hooks/use-course-languages';
import { convexErrorMessage } from '@/lib/utils';
import { OGTE_MIN_LEVEL, OGTE_MAX_LEVEL } from '@/lib/constants/onboarding';

/**
 * One-time dialog shown the first time new cards are about to be added:
 * "Does the difficulty feel right?"
 *
 * Level pager, not a slider. The dialog interrupts a learning session on a
 * phone, so stepping is two big chevrons flanking the card (easier left,
 * harder right) with a dot rail for position on the 1..20 scale. Each page
 * previews the sentences that would ACTUALLY be added next at that level.
 *
 * Both neighbours (level ±1) stay subscribed while the dialog is open, so a
 * step renders from the Convex client cache immediately and the new
 * neighbour loads behind it, no loading flash between pages.
 *
 * Closing the dialog by any path counts as "keep my level" (`onDone`), so
 * the held auto-add always resumes; re-offering a dismissed check would
 * block adding cards forever.
 */
export function DifficultyCheckDialog({
  open,
  currentLevel,
  onDone,
}: {
  open: boolean;
  /** The course's current OGTE level, already resolved by
   *  `useDifficultyCheck`, which is also what gates `open`, so a course
   *  with no level collection never reaches this dialog. Passing it in
   *  (rather than subscribing here) keeps the first render on the real
   *  level instead of a placeholder. */
  currentLevel: number;
  /** Mark the check completed and release the held auto-add. */
  onDone: () => void;
}) {
  const t = useTranslations('DifficultyCheck');
  const { baseLanguages, targetLanguages } = useCourseLanguages();
  const sourceLanguage = baseLanguages[0] ?? 'en';
  const targetLanguage = targetLanguages[0] ?? 'es';

  const setActiveCollectionByLevel = useMutation(
    api.features.decks.setActiveCollectionByLevel,
  );

  const [pagedLevel, setPagedLevel] = useState<number | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);

  // Re-arm the pager when the dialog closes, so a re-open starts from the
  // course's level again rather than wherever the last session was paged to.
  useEffect(() => {
    if (!open) setPagedLevel(null);
  }, [open]);

  const level = pagedLevel ?? clampOgte(currentLevel);
  const levelChanged = level !== currentLevel;

  // Three live subscriptions: the page on screen plus both neighbours. The
  // neighbour values are already in the client cache when the user steps, so
  // the swap is instant.
  const page = useQuery(
    api.features.decks.getUpcomingSentencesForLevel,
    open ? { ogteLevel: level } : 'skip',
  );
  const prevPage = useQuery(
    api.features.decks.getUpcomingSentencesForLevel,
    open && level > OGTE_MIN_LEVEL ? { ogteLevel: level - 1 } : 'skip',
  );
  const nextPage = useQuery(
    api.features.decks.getUpcomingSentencesForLevel,
    open && level < OGTE_MAX_LEVEL ? { ogteLevel: level + 1 } : 'skip',
  );

  // A neighbour is steppable unless we already know it doesn't exist or the
  // user has completed it (`setActiveCollectionByLevel` would throw). While
  // its query is still loading, allow the step. The page itself reports the
  // truth on arrival, which beats a chevron that flickers disabled.
  const canGoEasier =
    level > OGTE_MIN_LEVEL && (prevPage === undefined || prevPage.switchable);
  const canGoHarder =
    level < OGTE_MAX_LEVEL && (nextPage === undefined || nextPage.switchable);

  const step = useCallback(
    (delta: -1 | 1) => {
      if (isSwitching) return;
      setPagedLevel((prev) => {
        const base = prev ?? level;
        return clampOgte(base + delta);
      });
    },
    [isSwitching, level],
  );

  const handleConfirm = async () => {
    if (levelChanged) {
      setIsSwitching(true);
      try {
        await setActiveCollectionByLevel({ ogteLevel: level });
      } catch (error) {
        // Completed target level etc. Keep the dialog open so the user
        // can page to another level (or keep the current one).
        toast.error(convexErrorMessage(error) ?? t('switchFailed'));
        setIsSwitching(false);
        return;
      }
      setIsSwitching(false);
    }
    onDone();
  };

  const levelLabel = level.toString().padStart(2, '0');

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Any close counts as "keep", never re-ask, never block adds.
        if (!next && !isSwitching) onDone();
      }}
    >
      <DialogContent
        className="max-w-md max-h-[calc(100dvh-2rem)] overflow-y-auto"
        data-testid="difficulty-check-dialog"
        // ←/→ page the levels: the pager metaphor makes arrows the obvious
        // keyboard mapping, and it keeps the dialog usable without pointing.
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' && canGoEasier) {
            e.preventDefault();
            step(-1);
          } else if (e.key === 'ArrowRight' && canGoHarder) {
            e.preventDefault();
            step(1);
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('subtitle')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* The page. Chevrons overlay the card edges; the sentence column
              is inset past them so long lines never run underneath. */}
          <div className="relative rounded-xl border bg-muted/40 py-4 pl-14 pr-14">
            <PagerButton
              side="left"
              label={t('easier')}
              disabled={!canGoEasier || isSwitching}
              onClick={() => step(-1)}
              testId="difficulty-check-easier"
            />
            <PagerButton
              side="right"
              label={t('harder')}
              disabled={!canGoHarder || isSwitching}
              onClick={() => step(1)}
              testId="difficulty-check-harder"
            />

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-center gap-2">
                <span
                  className="text-2xl font-bold tabular-nums leading-none"
                  data-testid="difficulty-check-level"
                >
                  {levelLabel}
                </span>
                <Badge
                  variant="outline"
                  className="h-auto px-2.5 py-0 text-2xl font-bold leading-none"
                >
                  {cefrForOgte(level)}
                </Badge>
              </div>

              <div className="space-y-2">
                <div className="text-xs uppercase tracking-wide text-muted-foreground text-center">
                  {t('upcomingHeading', { level: levelLabel })}
                </div>
                {page?.exists === false ? (
                  <p className="rounded bg-muted/50 px-3 py-2 text-sm text-muted-foreground italic">
                    {t('levelUnavailable')}
                  </p>
                ) : (
                  <PreviewSentenceRows
                    rows={page?.sentences}
                    sourceLanguage={sourceLanguage}
                    targetLanguage={targetLanguage}
                  />
                )}
              </div>
            </div>
          </div>

          <LevelDots level={level} currentLevel={currentLevel} />
        </div>

        <Button
          onClick={handleConfirm}
          disabled={isSwitching}
          className="w-full"
          size="lg"
          data-testid="difficulty-check-confirm"
        >
          {isSwitching ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
              {t('switching')}
            </>
          ) : levelChanged ? (
            t('switchTo', { level: levelLabel })
          ) : (
            t('keep')
          )}
        </Button>
      </DialogContent>
    </Dialog>
  );
}

/** Edge chevron. 44px-wide target spanning most of the card height. The
 *  whole strip is tappable, not just the glyph. */
function PagerButton({
  side,
  label,
  disabled,
  onClick,
  testId,
}: {
  side: 'left' | 'right';
  label: string;
  disabled: boolean;
  onClick: () => void;
  testId: string;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'absolute inset-y-2 z-10 grid w-11 place-items-center rounded-lg',
        'text-muted-foreground transition-colors',
        'hover:bg-background hover:text-foreground',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:pointer-events-none disabled:opacity-30',
        side === 'left' ? 'left-1.5' : 'right-1.5',
      )}
    >
      <Icon className="h-6 w-6" />
    </button>
  );
}

/** Position on the 1..20 scale. Decorative. The level number above is the
 *  accessible source of truth, so this is hidden from screen readers. */
function LevelDots({
  level,
  currentLevel,
}: {
  level: number;
  currentLevel: number;
}) {
  const levels = Array.from(
    { length: OGTE_MAX_LEVEL - OGTE_MIN_LEVEL + 1 },
    (_, i) => OGTE_MIN_LEVEL + i,
  );
  return (
    <div className="flex items-center justify-center gap-1" aria-hidden="true">
      {levels.map((l) => (
        <span
          key={l}
          className={cn(
            'h-1.5 rounded-full transition-all',
            l === level
              ? 'w-4 bg-primary'
              : l === currentLevel
                ? 'w-1.5 bg-primary/40'
                : 'w-1.5 bg-muted-foreground/25',
          )}
        />
      ))}
    </div>
  );
}
