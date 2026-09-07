'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from 'convex/react';
import { toast } from 'sonner';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { getUserTimezone } from '@/lib/timezone';
import { reportError } from '@/lib/report-error';
import { ConfirmDialog } from '@/components/app/ConfirmDialog';
import { ConfettiBurst } from '@/components/effects/ConfettiBurst';
import { useAppData } from '@/components/app/AppDataProvider';
import {
  FlagTranslationDialog,
  type FlagSubmission,
} from './FlagTranslationDialog';

/** How long the reward confetti stays mounted after a paid flag. */
const FLAG_CELEBRATION_MS = 1600;

/** What `requestFlag` needs to know about the card to shape the dialog. */
export interface FlagTarget {
  cardId: Id<'cards'>;
  /**
   * A learner's own sentence has no shared rendering to correct, so the
   * gender and politeness picks are hidden for it. Defaults to false.
   */
  userCreated?: boolean;
}

export interface UseCardActionsOptions {
  /**
   * Runs when the delete dialog is confirmed. Owns the actual removal so each
   * surface keeps its own flow: LearningMode routes it through the exit
   * animation (`runExitingMutation`), the library clears its sticky rows
   * first. `helpers.deleteCard` is the shared raw mutation for callers
   * without their own wrapper. Must not reject — handle errors inside.
   */
  onConfirmDelete: (
    cardId: Id<'cards'>,
    helpers: { deleteCard: (cardId: Id<'cards'>) => Promise<void> },
  ) => void;
}

export interface CardActions {
  /** Open the delete confirmation for a card. */
  requestDelete: (cardId: Id<'cards'>) => void;
  /** Open the flag dialog for a card. */
  requestFlag: (
    cardId: Id<'cards'>,
    target?: Omit<FlagTarget, 'cardId'>,
  ) => void;
  deleteConfirmOpen: boolean;
  flagConfirmOpen: boolean;
  /** The card the flag dialog is open for, or null. */
  flagTarget: FlagTarget | null;
  closeDeleteConfirm: () => void;
  closeFlagConfirm: () => void;
  confirmDelete: () => void;
  /** Submit the open flag dialog with what the learner ticked. */
  confirmFlag: (submission: FlagSubmission) => void;
  /** Raw `deleteCardPermanently` call; rejections propagate to the caller. */
  deleteCard: (cardId: Id<'cards'>) => Promise<void>;
  /**
   * Fire the card-level flag: one mutation that enqueues a background
   * retranslation for EVERY non-source-language translation on the card at
   * once. Fire-and-forget. The card is remembered in `flaggedCardIds` only
   * when the server reports nothing was retranslated (all languages over-cap
   * or claim-contested); with a retranslation in flight the server-driven
   * "Retranslating" pill is the right signal instead.
   */
  flagCard: (cardId: Id<'cards'>, submission: FlagSubmission) => void;
  /**
   * Credits the last flag paid out, or null. Set for `FLAG_CELEBRATION_MS`
   * after a rewarded flag; `CardActionConfirmDialogs` renders the burst.
   */
  flagCelebration: number | null;
  /** Resolves true when the regeneration mutation was accepted. */
  regenerateAudio: (cardId: Id<'cards'>) => Promise<boolean>;
  updatePinnedActions: (actions: readonly string[]) => Promise<void>;
  /**
   * Client-only session record of cards the viewer has flagged. Drives the
   * "Flagged" pill. Purely local, never persisted, so it doesn't leak to
   * other users that someone flagged a row.
   */
  flaggedCardIds: ReadonlySet<Id<'cards'>>;
}

/**
 * The card-action set shared by LearningMode and the library: pin/unpin of
 * card actions, audio regeneration, flag-with-confirm and
 * delete-with-confirm (dialog state lives here; the markup is
 * `CardActionConfirmDialogs` below). One owner for the mutations and the
 * session-flag record so the two surfaces cannot drift.
 */
export function useCardActions(options: UseCardActionsOptions): CardActions {
  // Read at confirm time via a ref so callers may pass a fresh closure every
  // render without destabilizing `confirmDelete`.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const deleteCardMutation = useMutation(
    api.features.scheduling.deleteCardPermanently,
  );
  const flagTranslationMutation = useMutation(
    api.features.scheduling.flagTranslation,
  );
  const regenerateCardAudioMutation = useMutation(
    api.features.scheduling.regenerateCardAudio,
  );
  const updatePinnedCardActionsMutation = useMutation(
    api.features.courses.updatePinnedCardActions,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(
      api.features.courses.getUserSettings,
      {},
    );
    if (current != null) {
      localStore.setQuery(
        api.features.courses.getUserSettings,
        {},
        { ...current, pinnedCardActions: [...args.actions] },
      );
    }
  });

  const [deleteConfirmCardId, setDeleteConfirmCardId] =
    useState<Id<'cards'> | null>(null);
  const [flagTarget, setFlagTarget] = useState<FlagTarget | null>(null);
  const [flagCelebration, setFlagCelebration] = useState<number | null>(null);
  const t = useTranslations('LearningMode.actions');
  const [flaggedCardIds, setFlaggedCardIds] = useState<Set<Id<'cards'>>>(
    () => new Set(),
  );

  const requestDelete = useCallback((cardId: Id<'cards'>) => {
    setDeleteConfirmCardId(cardId);
  }, []);
  const requestFlag = useCallback(
    (cardId: Id<'cards'>, target?: Omit<FlagTarget, 'cardId'>) => {
      setFlagTarget({ cardId, ...target });
    },
    [],
  );
  const closeDeleteConfirm = useCallback(() => {
    setDeleteConfirmCardId(null);
  }, []);
  const closeFlagConfirm = useCallback(() => {
    setFlagTarget(null);
  }, []);

  useEffect(() => {
    if (flagCelebration === null) return;
    const timer = setTimeout(
      () => setFlagCelebration(null),
      FLAG_CELEBRATION_MS,
    );
    return () => clearTimeout(timer);
  }, [flagCelebration]);

  const deleteCard = useCallback(
    async (cardId: Id<'cards'>) => {
      await deleteCardMutation({ cardId });
    },
    [deleteCardMutation],
  );

  const flagCard = useCallback(
    (cardId: Id<'cards'>, submission: FlagSubmission) => {
      flagTranslationMutation({ cardId, ...submission })
        .then((result) => {
          if (!result) return;
          // A pinned card that was moved to the latest curriculum wording
          // is not "flagged": its content updates reactively instead.
          if (result.retranslated === false && !result.updatedToLatest) {
            setFlaggedCardIds((prev) => {
              if (prev.has(cardId)) return prev;
              const next = new Set(prev);
              next.add(cardId);
              return next;
            });
          }
          // The thanks always, the credits and the confetti only for what
          // actually landed (capped months, repeat flags and own sentences
          // pay nothing).
          if (result.creditsAwarded > 0) {
            setFlagCelebration(result.creditsAwarded);
            toast.success(t('flagRewardTitle'), {
              description: t('flagRewardBody', {
                credits: result.creditsAwarded,
              }),
              duration: 6000,
            });
          } else {
            toast.success(t('flagRewardTitle'), {
              description: t('flagThanksBody'),
            });
          }
        })
        .catch((error) => {
          reportError(error, { op: 'flagTranslation', cardId });
        });
    },
    [flagTranslationMutation, t],
  );

  const confirmDelete = useCallback(() => {
    const cardId = deleteConfirmCardId;
    if (cardId === null) return;
    setDeleteConfirmCardId(null);
    optionsRef.current.onConfirmDelete(cardId, { deleteCard });
  }, [deleteConfirmCardId, deleteCard]);

  const confirmFlag = useCallback(
    (submission: FlagSubmission) => {
      const target = flagTarget;
      if (target === null) return;
      setFlagTarget(null);
      flagCard(target.cardId, submission);
    },
    [flagTarget, flagCard],
  );

  const regenerateAudio = useCallback(
    async (cardId: Id<'cards'>) => {
      try {
        await regenerateCardAudioMutation({
          cardId,
          timezone: getUserTimezone(),
        });
        return true;
      } catch (error) {
        reportError(error, { op: 'regenerateCardAudio', cardId });
        return false;
      }
    },
    [regenerateCardAudioMutation],
  );

  const updatePinnedActions = useCallback(
    async (actions: readonly string[]) => {
      try {
        await updatePinnedCardActionsMutation({ actions: [...actions] });
      } catch (error) {
        reportError(error, { op: 'updatePinnedCardActions' });
      }
    },
    [updatePinnedCardActionsMutation],
  );

  return {
    requestDelete,
    requestFlag,
    deleteConfirmOpen: deleteConfirmCardId !== null,
    flagConfirmOpen: flagTarget !== null,
    flagTarget,
    closeDeleteConfirm,
    closeFlagConfirm,
    confirmDelete,
    confirmFlag,
    deleteCard,
    flagCard,
    flagCelebration,
    regenerateAudio,
    updatePinnedActions,
    flaggedCardIds,
  };
}

/**
 * The delete + flag confirmation dialogs for a `useCardActions` instance.
 * Render once near the view root (LearningMode and LibraryView both do);
 * the copy is the shared `LearningMode.actions.*` set.
 */
export function CardActionConfirmDialogs({
  actions,
}: {
  actions: CardActions;
}) {
  const t = useTranslations('LearningMode');
  const { activeCourse } = useAppData();
  const courseLanguages = activeCourse
    ? [...activeCourse.baseLanguages, ...activeCourse.targetLanguages]
    : [];
  return (
    <>
      <ConfirmDialog
        open={actions.deleteConfirmOpen}
        onOpenChange={(open) => {
          if (!open) actions.closeDeleteConfirm();
        }}
        title={t('actions.deleteConfirmTitle')}
        description={t('actions.deleteConfirmDescription')}
        cancelLabel={t('actions.deleteConfirmCancel')}
        confirmLabel={t('actions.deleteConfirmConfirm')}
        confirmTestId="card-delete-confirm"
        onConfirm={actions.confirmDelete}
        destructive
      />
      <FlagTranslationDialog
        open={actions.flagConfirmOpen}
        onOpenChange={(open) => {
          if (!open) actions.closeFlagConfirm();
        }}
        onSubmit={actions.confirmFlag}
        courseLanguages={courseLanguages}
        allowCorrections={actions.flagTarget?.userCreated !== true}
      />
      {actions.flagCelebration !== null && (
        <div
          className="pointer-events-none fixed inset-x-0 top-1/3 z-[100] flex justify-center"
          aria-hidden
          data-testid="flag-celebration"
        >
          <ConfettiBurst count={40} />
        </div>
      )}
    </>
  );
}
