'use client';

import { useEffect } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { ENSURE_CONTENT_RETRY_MS } from '@/lib/constants/learning';

const BATCH_SIZE = 5;

const ensuredGlobal = new Set<string>();

/**
 * Automatically calls `ensureCardContent` for cards with missing content.
 * Uses a module-level Set so the same textId is never re-triggered across
 * components or after unmount/remount within the same page session.
 *
 * A card whose ensure call scheduled nothing is un-marked after a cooldown
 * instead of staying latched for the session: "nothing scheduled" can mean a
 * claim held by a job that later died, and latching forever turned that into
 * a permanent missing-audio spinner. If the content actually completed in
 * the meantime, `hasMissingContent` is false and the un-marked card never
 * re-fires.
 */
export function useEnsureContent(
  cards:
    | Array<{ textId: string; hasMissingContent: boolean }>
    | null
    | undefined,
) {
  const ensureCardContent = useMutation(api.features.decks.ensureCardContent);

  useEffect(() => {
    if (!cards) return;

    const toProcess = cards
      .filter((c) => c.hasMissingContent && !ensuredGlobal.has(c.textId))
      .slice(0, BATCH_SIZE);

    for (const card of toProcess) {
      ensuredGlobal.add(card.textId);
      ensureCardContent({ textId: card.textId as Id<'texts'> })
        .then((result) => {
          if (
            result.translationsScheduled === 0 &&
            result.audioScheduled === 0
          ) {
            setTimeout(
              () => ensuredGlobal.delete(card.textId),
              ENSURE_CONTENT_RETRY_MS,
            );
          }
        })
        .catch(() => {
          ensuredGlobal.delete(card.textId);
        });
    }
  }, [cards, ensureCardContent]);
}
