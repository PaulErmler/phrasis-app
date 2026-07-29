/**
 * Store screenshot & marketing asset pipeline.
 *
 * 1. Captures the mock screens at /screenshots/[screen] (real components,
 *    mocked data) with Playwright at device resolution.
 * 2. Composes each capture into a framed marketing image (brand background,
 *    headline, device frame with status bar) at the exact store sizes:
 *      - App Store (iPhone 6.9"): 1320×2868
 *      - Google Play phone:       1080×1920
 * 3. Renders the Play feature graphic (1024×500) and the store icons
 *    (App Store 1024×1024 opaque, Play 512×512).
 *
 * Usage:
 *   pnpm dev            # in one terminal (or set BASE_URL to a running build)
 *   pnpm store:assets   # in another
 *
 * Output: store-assets/{ios,android,common}/
 */

import { chromium, type Browser } from '@playwright/test';
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = join(process.cwd(), 'store-assets');
const RAW = join(OUT, 'raw');

/** CSS viewport for raw captures; @3x = 1320×2868 (exact 6.9" size). */
const CAPTURE = { width: 440, height: 956, scale: 3 };

const TARGETS = {
  ios: { width: 1320, height: 2868 },
  android: { width: 1080, height: 1920 },
} as const;

interface ScreenSpec {
  slug: string;
  /** Marketing headline shown above the device. */
  headline: string;
  subline?: string;
  theme: 'dark' | 'light';
  /** Extra settle time for charts/animations. */
  settleMs?: number;
}

const SCREENS: ScreenSpec[] = [
  {
    slug: 'home',
    headline: 'Put fluency on autopilot.',
    subline: 'Spaced repetition schedules every sentence at the perfect moment.',
    theme: 'dark',
  },
  {
    slug: 'review',
    headline: 'Shadow real sentences out loud.',
    subline: 'Listen, speak, and learn hands-free — on your commute or your couch.',
    theme: 'dark',
  },
  {
    slug: 'chat',
    headline: 'Ask anything. Remember the answer.',
    subline: 'The AI tutor turns every question into new flashcards.',
    theme: 'dark',
  },
  {
    slug: 'stats',
    headline: 'Watch your fluency grow.',
    subline: 'Streaks, words, and listening time — all in one place.',
    theme: 'dark',
    settleMs: 1200,
  },
  {
    slug: 'testimonials',
    headline: 'Loved by language learners.',
    subline: 'Real reviews from the Reddit language-learning community.',
    theme: 'dark',
  },
];

// accent = the app's real primary, oklch(0.7162 0.119 217.31) resolved to
// sRGB — NOT the manifest's green, which isn't part of the design system.
const BRAND = {
  bgTop: '#0d1117',
  bgBottom: '#101826',
  accent: '#2bb5d4',
  accentGlow: (a: number) => `rgba(43, 181, 212, ${a})`,
  text: '#f0f6fc',
  subtext: '#8b949e',
};

function statusBarSvg(fg: string): string {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;height:100%;padding:0 28px;color:${fg};font-weight:600;font-size:22px;">
      <span>9:41</span>
      <span style="display:flex;gap:10px;align-items:center;">
        <svg width="24" height="16" viewBox="0 0 24 16" fill="currentColor"><rect x="0" y="10" width="4" height="6" rx="1"/><rect x="6" y="7" width="4" height="9" rx="1"/><rect x="12" y="4" width="4" height="12" rx="1"/><rect x="18" y="1" width="4" height="15" rx="1"/></svg>
        <svg width="22" height="16" viewBox="0 0 22 16" fill="currentColor"><path d="M11 13.5a2 2 0 1 0 .001 4.001A2 2 0 0 0 11 13.5zm0-5c-2.5 0-4.8 1-6.5 2.6l1.8 1.9A6.7 6.7 0 0 1 11 11c1.8 0 3.5.7 4.7 2l1.8-1.9A9.2 9.2 0 0 0 11 8.5zm0-5C7 3.5 3.4 5 .7 7.6l1.8 1.9A12.7 12.7 0 0 1 11 6c3.3 0 6.3 1.3 8.5 3.4l1.8-1.9A15.2 15.2 0 0 0 11 3.5z" transform="translate(0 -2)"/></svg>
        <svg width="30" height="16" viewBox="0 0 30 16" fill="none" stroke="currentColor"><rect x="1" y="2" width="24" height="12" rx="3.5" stroke-width="1.5"/><rect x="3.5" y="4.5" width="17" height="7" rx="1.5" fill="currentColor" stroke="none"/><path d="M27.5 6v4a2.2 2.2 0 0 0 0-4z" fill="currentColor" stroke="none"/></svg>
      </span>
    </div>`;
}

/** Framed marketing composition rendered at the exact target size. */
function composeHtml(opts: {
  width: number;
  height: number;
  headline: string;
  subline?: string;
  screenshotDataUri: string;
  statusBg: string;
  statusFg: string;
  /**
   * true → the whole phone fits inside the canvas at its real aspect ratio
   * (rounded on all sides, margin below). false → the phone bleeds off the
   * bottom edge (used where the canvas is too short to contain it).
   */
  containDevice: boolean;
}): string {
  const { width, height, headline, subline, screenshotDataUri, statusBg, statusFg, containDevice } = opts;
  // Scale typography/frame with canvas width so both stores look identical.
  const u = width / 1320;
  const frameW = Math.round((containDevice ? 960 : 1010) * u);
  const bezel = Math.round(22 * u);
  const radius = Math.round(110 * u);
  const statusH = Math.round(96 * u);
  // Screen content keeps the capture's true aspect ratio, so the contained
  // device has genuine phone proportions instead of stretching to the canvas.
  const screenH = Math.round((frameW - 2 * bezel) * (CAPTURE.height / CAPTURE.width));
  const deviceH = 2 * bezel + statusH + screenH;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
    background:
      radial-gradient(120% 55% at 50% -8%, ${BRAND.accentGlow(0.24)}, transparent 60%),
      linear-gradient(180deg, ${BRAND.bgTop} 0%, ${BRAND.bgBottom} 100%);
    display: flex; flex-direction: column; align-items: center;
  }
  .headline {
    margin-top: ${Math.round(130 * u)}px;
    padding: 0 ${Math.round(90 * u)}px;
    color: ${BRAND.text};
    font-size: ${Math.round(84 * u)}px;
    font-weight: 800;
    letter-spacing: -0.02em;
    text-align: center;
    line-height: 1.12;
  }
  .headline .accent { color: ${BRAND.accent}; }
  .subline {
    margin-top: ${Math.round(34 * u)}px;
    padding: 0 ${Math.round(130 * u)}px;
    color: ${BRAND.subtext};
    font-size: ${Math.round(40 * u)}px;
    font-weight: 500;
    text-align: center;
    line-height: 1.35;
  }
  .device {
    margin-top: ${Math.round(72 * u)}px;
    width: ${frameW}px;
    ${containDevice ? `height: ${deviceH}px;` : 'flex: 1;'}
    background: #050708;
    border: ${bezel}px solid #1f2733;
    ${containDevice ? '' : 'border-bottom: none;'}
    border-radius: ${containDevice ? `${radius}px` : `${radius}px ${radius}px 0 0`};
    box-shadow: 0 ${Math.round(-8 * u)}px ${Math.round(120 * u)}px ${BRAND.accentGlow(0.18)},
                0 ${Math.round(40 * u)}px ${Math.round(120 * u)}px rgba(0,0,0,0.6);
    overflow: hidden;
    display: flex; flex-direction: column;
  }
  .status { height: ${statusH}px; background: ${statusBg}; flex-shrink: 0; }
  .screen { flex: 1; overflow: hidden; }
  .screen img { width: 100%; display: block; }
</style></head>
<body>
  <div class="headline">${headline.replace(/\.$/, '<span class="accent">.</span>')}</div>
  ${subline ? `<div class="subline">${subline}</div>` : ''}
  <div class="device">
    <div class="status">${statusBarSvg(statusFg)}</div>
    <div class="screen"><img src="${screenshotDataUri}" /></div>
  </div>
</body></html>`;
}

function featureGraphicHtml(logoDataUri: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1024px; height: 500px; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background:
      radial-gradient(90% 130% at 85% 20%, ${BRAND.accentGlow(0.3)}, transparent 60%),
      linear-gradient(135deg, ${BRAND.bgTop} 0%, ${BRAND.bgBottom} 100%);
    display: flex; align-items: center; gap: 48px; padding: 0 72px;
  }
  .logo { width: 210px; height: 210px; border-radius: 48px; background: #ffffff;
          display: flex; align-items: center; justify-content: center;
          box-shadow: 0 24px 80px rgba(0,0,0,0.5); flex-shrink: 0; }
  .logo img { width: 165px; height: 165px; }
  h1 { color: ${BRAND.text}; font-size: 84px; font-weight: 800; letter-spacing: -0.02em; }
  p  { color: ${BRAND.subtext}; font-size: 34px; font-weight: 500; margin-top: 14px; line-height: 1.3; }
  .accent { color: ${BRAND.accent}; }
</style></head>
<body>
  <div class="logo"><img src="${logoDataUri}" /></div>
  <div>
    <h1>Flexling</h1>
    <p>Put fluency on <span class="accent">autopilot</span> —<br/>audio flashcards, spaced repetition &amp; AI tutor.</p>
  </div>
</body></html>`;
}

async function renderHtml(browser: Browser, html: string, width: number, height: number, outFile: string) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  await page.screenshot({ path: outFile });
  await page.close();
}

async function main() {
  for (const dir of [OUT, RAW, join(OUT, 'ios'), join(OUT, 'android'), join(OUT, 'common')]) {
    mkdirSync(dir, { recursive: true });
  }

  // Fail fast if the app isn't running.
  try {
    await fetch(`${BASE_URL}/screenshots/home`, { method: 'HEAD' });
  } catch {
    console.error(`Cannot reach ${BASE_URL} — start the app first (pnpm dev) or set BASE_URL.`);
    process.exit(1);
  }

  const browser = await chromium.launch();

  // ---- 1. Raw captures --------------------------------------------------
  for (const spec of SCREENS) {
    const page = await browser.newPage({
      viewport: { width: CAPTURE.width, height: CAPTURE.height },
      deviceScaleFactor: CAPTURE.scale,
      colorScheme: spec.theme,
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${BASE_URL}/screenshots/${spec.slug}`, { waitUntil: 'networkidle' });
    await page.addStyleTag({
      content: [
        '*, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }',
        // Not part of the product shot: consent banner + Next.js dev overlay.
        '[data-testid="consent-banner"] { display: none !important; }',
        'nextjs-portal { display: none !important; }',
      ].join('\n'),
    });
    await page.waitForTimeout(spec.settleMs ?? 500);
    const rawPath = join(RAW, `${spec.slug}-${spec.theme}.png`);
    await page.screenshot({ path: rawPath });
    await page.close();
    console.log(`raw: ${rawPath}`);
  }

  // ---- 2. Framed marketing compositions ---------------------------------
  for (const [platform, size] of Object.entries(TARGETS)) {
    for (const [i, spec] of SCREENS.entries()) {
      const rawPath = join(RAW, `${spec.slug}-${spec.theme}.png`);
      const raw = readFileSync(rawPath);
      // Sample the app's own background so the drawn status bar blends in.
      const { data } = await sharp(raw).raw().toBuffer({ resolveWithObject: true });
      const [r, g, b] = [data[0], data[1], data[2]];
      const statusBg = `rgb(${r},${g},${b})`;
      const statusFg = (r * 0.299 + g * 0.587 + b * 0.114) > 140 ? '#111827' : '#f0f6fc';

      const html = composeHtml({
        width: size.width,
        height: size.height,
        headline: spec.headline,
        subline: spec.subline,
        screenshotDataUri: `data:image/png;base64,${raw.toString('base64')}`,
        statusBg,
        statusFg,
        // The tall iOS canvas fits a whole phone at true proportions; the
        // 9:16 Play canvas would shrink it too much, so it bleeds there.
        containDevice: platform === 'ios',
      });
      const outFile = join(OUT, platform, `${String(i + 1).padStart(2, '0')}-${spec.slug}.png`);
      await renderHtml(browser, html, size.width, size.height, outFile);
      console.log(`${platform}: ${outFile}`);
    }
  }

  // ---- 3. Icons + feature graphic ---------------------------------------
  const logo = readFileSync(join(process.cwd(), 'assets', 'logo.png'));
  const iconOn = async (px: number, file: string) => {
    const inner = await sharp(logo)
      .resize(Math.round(px * 0.82), Math.round(px * 0.82), { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 0 } })
      .png()
      .toBuffer();
    await sharp({ create: { width: px, height: px, channels: 3, background: '#ffffff' } })
      .composite([{ input: inner, gravity: 'centre' }])
      .png()
      .toFile(file);
    console.log(`icon: ${file}`);
  };
  await iconOn(1024, join(OUT, 'common', 'app-store-icon-1024.png'));
  await iconOn(512, join(OUT, 'common', 'play-icon-512.png'));

  await renderHtml(
    browser,
    featureGraphicHtml(`data:image/png;base64,${logo.toString('base64')}`),
    1024,
    500,
    join(OUT, 'common', 'play-feature-graphic-1024x500.png'),
  );
  console.log('feature graphic done');

  await browser.close();
  console.log(`\nAll assets in ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
