'use client';

import { useEffect } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';

const BATCH_SIZE = 5;

const ensuredGlobal = new Set<string>();

/**
 * Automatically calls `ensureCardContent` for cards with missing content.
 * Uses a module-level Set so the same textId is never re-triggered across
 * components or after unmount/remount within the same page session.
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
      ensureCardContent({ textId: card.textId as Id<'texts'> }).catch(() => {
        ensuredGlobal.delete(card.textId);
      });
    }
  }, [cards, ensureCardContent]);
}
