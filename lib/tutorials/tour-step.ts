import type { Alignment, DriveStep, Side } from 'driver.js';
import type { TranslateFn } from './types';

/**
 * Builds a driver.js step from a `Tutorial` i18n key prefix: the popover
 * reads `${key}.title` / `${key}.description`. Pass `element` (a CSS
 * selector) plus `side`/`align` for anchored steps; omit all three for a
 * centered modal-style popover.
 */
export function tourStep(
  t: TranslateFn,
  key: string,
  element?: string,
  side?: Side,
  align?: Alignment,
): DriveStep {
  const popover: NonNullable<DriveStep['popover']> = {
    title: t(`${key}.title`),
    description: t(`${key}.description`),
  };
  if (side !== undefined) popover.side = side;
  if (align !== undefined) popover.align = align;
  return element !== undefined ? { element, popover } : { popover };
}
