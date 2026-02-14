/**
 * Text-to-Speech constants for the Phrasis app
 */

/** Maximum text length for TTS generation */
export const MAX_TTS_LENGTH = 500;

/** Valid speed range for speaking_rate */
export const MIN_TTS_SPEED = 0.5;
export const MAX_TTS_SPEED = 1.0;

/** Available speed options for TTS (speaking_rate: 0.5 to 1.0) */
export const TTS_SPEED_OPTIONS = [
  { value: 0.5, label: 'Very Slow (0.5x)' },
  { value: 0.6, label: 'Slow (0.6x)' },
  { value: 0.7, label: 'Moderate Slow (0.7x)' },
  { value: 0.8, label: 'Slightly Slow (0.8x)' },
  { value: 0.9, label: 'Near Normal (0.9x)' },
  { value: 1.0, label: 'Normal (1.0x)' },
] as const;

/** Default speed for TTS */
export const DEFAULT_TTS_SPEED = 1.0;
