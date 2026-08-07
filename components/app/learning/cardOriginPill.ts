import { CEFR_COLORS, isCefr } from '@/components/app/segmented/cefr';

/** Resolved content of the card-origin pill in the card header. */
export interface CardOriginPill {
  /** "A1.2" for premade cards, localized "Custom"/"Chat" otherwise. */
  label: string;
  /** CEFR tier color (matches the home-screen level chips); undefined = neutral. */
  color?: string;
}

/**
 * Build the card-origin pill from a card's collection fields, shared by the
 * learn view and the library. Returns null when the pill should be hidden —
 * setting off, or the collection couldn't be resolved.
 */
export function buildCardOriginPill(
  show: boolean,
  card: {
    collectionLabel: string | null;
    collectionOrigin: 'premade' | 'custom' | 'chat' | null;
    collectionCefrTier: string | null;
  },
  t: (key: 'cardOriginCustom' | 'cardOriginChat') => string,
): CardOriginPill | null {
  if (!show) return null;
  if (card.collectionOrigin === 'custom') return { label: t('cardOriginCustom') };
  if (card.collectionOrigin === 'chat') return { label: t('cardOriginChat') };
  if (!card.collectionLabel) return null;
  return {
    label: card.collectionLabel,
    color:
      card.collectionCefrTier && isCefr(card.collectionCefrTier)
        ? CEFR_COLORS[card.collectionCefrTier]
        : undefined,
  };
}
