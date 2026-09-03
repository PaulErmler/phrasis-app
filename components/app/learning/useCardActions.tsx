'use client';

import { useCallback, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { getUserTimezone } from '@/lib/timezone';
import { reportError } from '@/lib/report-error';
import { ConfirmDialog } from '@/components/app/ConfirmDialog';

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
  /** Open the flag confirmation for a card. */
  requestFlag: (cardId: Id<'cards'>) => void;
  deleteConfirmOpen: boolean;
  flagConfirmOpen: boolean;
  closeDeleteConfirm: () => void;
  closeFlagConfirm: () => void;
  confirmDelete: () => void;
  confirmFlag: () => void;
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
  flagCard: (cardId: Id<'cards'>) => void;
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
  const [flagConfirmCardId, setFlagConfirmCardId] =
    useState<Id<'cards'> | null>(null);
  const [flaggedCardIds, setFlaggedCardIds] = useState<Set<Id<'cards'>>>(
    () => new Set(),
  );

  const requestDelete = useCallback((cardId: Id<'cards'>) => {
    setDeleteConfirmCardId(cardId);
  }, []);
  const requestFlag = useCallback((cardId: Id<'cards'>) => {
    setFlagConfirmCardId(cardId);
  }, []);
  const closeDeleteConfirm = useCallback(() => {
    setDeleteConfirmCardId(null);
  }, []);
  const closeFlagConfirm = useCallback(() => {
    setFlagConfirmCardId(null);
  }, []);

  const deleteCard = useCallback(
    async (cardId: Id<'cards'>) => {
      await deleteCardMutation({ cardId });
    },
    [deleteCardMutation],
  );

  const flagCard = useCallback(
    (cardId: Id<'cards'>) => {
      flagTranslationMutation({ cardId })
        .then((result) => {
          // A pinned card that was moved to the latest curriculum wording
          // is not "flagged": its content updates reactively instead.
          if (
            result &&
            result.retranslated === false &&
            !result.updatedToLatest
          ) {
            setFlaggedCardIds((prev) => {
              if (prev.has(cardId)) return prev;
              const next = new Set(prev);
              next.add(cardId);
              return next;
            });
          }
        })
        .catch((error) => {
          reportError(error, { op: 'flagTranslation', cardId });
        });
    },
    [flagTranslationMutation],
  );

  const confirmDelete = useCallback(() => {
    const cardId = deleteConfirmCardId;
    if (cardId === null) return;
    setDeleteConfirmCardId(null);
    optionsRef.current.onConfirmDelete(cardId, { deleteCard });
  }, [deleteConfirmCardId, deleteCard]);

  const confirmFlag = useCallback(() => {
    const cardId = flagConfirmCardId;
    if (cardId === null) return;
    setFlagConfirmCardId(null);
    flagCard(cardId);
  }, [flagConfirmCardId, flagCard]);

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
    flagConfirmOpen: flagConfirmCardId !== null,
    closeDeleteConfirm,
    closeFlagConfirm,
    confirmDelete,
    confirmFlag,
    deleteCard,
    flagCard,
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
      <ConfirmDialog
        open={actions.flagConfirmOpen}
        onOpenChange={(open) => {
          if (!open) actions.closeFlagConfirm();
        }}
        title={t('actions.flagConfirmTitle')}
        description={t('actions.flagConfirmDescription')}
        cancelLabel={t('actions.flagConfirmCancel')}
        confirmLabel={t('actions.flagConfirmConfirm')}
        onConfirm={actions.confirmFlag}
      />
    </>
  );
}
