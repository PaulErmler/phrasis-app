/**
 * Raw capture of the mock screens at /screenshots/[screen] (real components,
 * mocked data), shared by the store-asset scripts so every marketing image
 * starts from the same pixels: same viewport, same settle CSS, same wait.
 */

import type { Browser } from '@playwright/test';

/** CSS viewport for raw captures; @3x = 1320×2868 (exact 6.9" size). */
export const CAPTURE_VIEWPORT = { width: 440, height: 956, scale: 3 } as const;

/**
 * Freeze the page for a deterministic shot: no animations or transitions, no
 * blinking caret, and neither the consent banner nor Next's dev overlay.
 */
const SETTLE_CSS = [
  '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
  '[data-testid="consent-banner"] { display: none !important; }',
  'nextjs-portal { display: none !important; }',
].join('\n');

export interface CaptureScreenOptions {
  /** The /screenshots/[slug] route to capture. */
  slug: string;
  theme: 'light' | 'dark';
  /** Where the PNG is written. */
  outPath: string;
  baseUrl: string;
  /** How long to let the page settle after the CSS freeze before shooting. */
  settleMs: number;
  /** Playwright's navigation timeout; its default (30 s) when omitted. */
  gotoTimeoutMs?: number;
  viewport?: { width: number; height: number; scale: number };
}

/** Open the screen in a fresh page, freeze it, screenshot, close. */
export async function captureScreen(
  browser: Browser,
  {
    slug,
    theme,
    outPath,
    baseUrl,
    settleMs,
    gotoTimeoutMs,
    viewport = CAPTURE_VIEWPORT,
  }: CaptureScreenOptions,
): Promise<void> {
  const page = await browser.newPage({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: viewport.scale,
    colorScheme: theme,
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`${baseUrl}/screenshots/${slug}`, {
    waitUntil: 'networkidle',
    ...(gotoTimeoutMs !== undefined ? { timeout: gotoTimeoutMs } : {}),
  });
  await page.addStyleTag({ content: SETTLE_CSS });
  await page.waitForTimeout(settleMs);
  await page.screenshot({ path: outPath });
  await page.close();
}
