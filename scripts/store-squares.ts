/**
 * Square (800×800) marketing images — the small format used for social cards,
 * blog headers and app-directory tiles.
 *
 * Captures the same mock screens as scripts/store-screenshots.ts
 * (/screenshots/[screen], real components + mocked data) and composes six
 * layouts on backgrounds built only from the app's own tokens (globals.css
 * oklch values resolved to sRGB) and the logo's card palette.
 *
 * Usage:
 *   pnpm dev                # or any dev server on BASE_URL
 *   pnpm store:squares
 *
 * Output: store-assets/square/
 */

import { chromium, type Browser } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { CAPTURE_VIEWPORT, captureScreen } from './lib/captureScreens';

const OUT = process.argv[2] ?? join(process.cwd(), 'store-assets', 'square');
mkdirSync(OUT, { recursive: true });
const RAWDIR = join(OUT, '_raw');
const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const SLUGS = [
  'home',
  'review',
  'stats',
  'chat',
  'writing',
  'radio',
  'languages',
  'custom',
];

/** Re-capture the mock screens at 3× phone resolution, light + dark. */
async function capture(browser: Browser) {
  mkdirSync(RAWDIR, { recursive: true });
  for (const theme of ['light', 'dark'] as const) {
    for (const slug of SLUGS) {
      await captureScreen(browser, {
        slug,
        theme,
        outPath: join(RAWDIR, `${slug}-${theme}.png`),
        baseUrl: BASE_URL,
        settleMs: 900,
        gotoTimeoutMs: 120_000,
      });
    }
  }
}

/** App tokens (globals.css oklch → sRGB) + logo card palette. */
const C = {
  primary: '#2bb5d4',
  primaryLight: '#c0eefb',
  orange: '#d45c2b',
  orangeLight: '#ffdbca',
  amber: '#ffb300',
  bgDark: '#0a0a0a',
  cardDark: '#171717',
  fgDark: '#fafafa',
};

const raw = (n: string) =>
  `data:image/png;base64,${readFileSync(join(RAWDIR, `${n}.png`)).toString('base64')}`;

const SCREEN_ASPECT = CAPTURE_VIEWPORT.height / CAPTURE_VIEWPORT.width;

/**
 * A phone. `crop` = fraction of the screen shown from the top (1 = whole
 * screen); anything less lets the device run off the bottom of the canvas.
 */
function phone(o: {
  img: string;
  width: number;
  crop?: number;
  bezel?: number;
  radius?: number;
  statusBg: string;
  statusFg: string;
  shadow?: string;
  style?: string;
  /** Screen background the crop edge fades into. */
  fade?: string;
}) {
  const bezel = o.bezel ?? 9;
  const radius = o.radius ?? 46;
  const inner = o.width - 2 * bezel;
  const statusH = 26;
  const fullScreen = inner * SCREEN_ASPECT;
  const crop = o.crop ?? 1;
  const shownScreen = Math.round(fullScreen * crop);
  const h = 2 * bezel + statusH + shownScreen;
  return `
  <div style="width:${o.width}px;height:${h}px;background:#050708;border:${bezel}px solid #1c242e;
              border-radius:${radius}px;overflow:hidden;display:flex;flex-direction:column;flex-shrink:0;
              box-shadow:${o.shadow ?? '0 26px 60px rgba(9,45,60,.28), 0 6px 18px rgba(9,45,60,.16)'};${o.style ?? ''}">
    <div style="height:${statusH}px;background:${o.statusBg};color:${o.statusFg};flex-shrink:0;display:flex;
                align-items:center;justify-content:space-between;padding:0 ${bezel + 8}px;font-size:11px;font-weight:600;">
      <span>9:41</span>
      <span style="display:flex;gap:4px;align-items:center;">
        <svg width="13" height="9" viewBox="0 0 24 16" fill="currentColor"><rect x="0" y="10" width="4" height="6" rx="1"/><rect x="6" y="7" width="4" height="9" rx="1"/><rect x="12" y="4" width="4" height="12" rx="1"/><rect x="18" y="1" width="4" height="15" rx="1"/></svg>
        <svg width="16" height="9" viewBox="0 0 30 16" fill="none" stroke="currentColor"><rect x="1" y="2" width="24" height="12" rx="3.5" stroke-width="1.6"/><rect x="3.5" y="4.5" width="17" height="7" rx="1.5" fill="currentColor" stroke="none"/><path d="M27.5 6v4a2.2 2.2 0 0 0 0-4z" fill="currentColor" stroke="none"/></svg>
      </span>
    </div>
    <div style="flex:1;overflow:hidden;position:relative;">
      <img src="${o.img}" style="width:100%;display:block;"/>
      ${
        crop < 1
          ? `<div style="position:absolute;left:0;right:0;bottom:0;height:56px;
           background:linear-gradient(180deg,transparent,${o.fade ?? '#ffffff'});"></div>`
          : ''
      }
    </div>
  </div>`;
}

const page = (body: string, bg: string) => `<!DOCTYPE html><html><head><style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:800px;height:800px;overflow:hidden}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;${bg}}
</style></head><body>${body}</body></html>`;

const LIGHT = { statusBg: '#ffffff', statusFg: '#0a0a0a', fade: '#ffffff' };
const DARK = { statusBg: C.bgDark, statusFg: '#f0f6fc', fade: C.bgDark };

/** 1. soft — the whole phone floating on a pastel brand gradient. */
const soft = (img: string) =>
  page(
    `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
       ${phone({ img, width: 300, ...LIGHT })}
     </div>`,
    `background:
       radial-gradient(70% 60% at 18% 8%, ${C.orangeLight} 0%, transparent 62%),
       radial-gradient(75% 70% at 88% 92%, ${C.primaryLight} 0%, transparent 60%),
       linear-gradient(150deg,#fdf3ec 0%,#eef8fb 52%,#dff2f9 100%);`,
  );

/** 2. zoom — cropped device, UI at near-native size. */
const zoom = (img: string) =>
  page(
    `<div style="width:100%;height:100%;display:flex;align-items:flex-end;justify-content:center;padding-top:84px;">
       ${phone({ img, width: 430, crop: 0.72, bezel: 11, radius: 56, ...LIGHT })}
     </div>`,
    `background:
       radial-gradient(60% 45% at 50% 0%, ${C.primaryLight} 0%, transparent 70%),
       linear-gradient(180deg,#f4fbfd 0%,#e3f4fa 100%);`,
  );

/** 3. cards — the logo's stacked-flashcard motif in its own palette. */
const cards = (img: string) =>
  page(
    `<div style="position:relative;width:100%;height:100%;">
       <div style="position:absolute;top:150px;left:50%;width:322px;height:452px;border-radius:44px;
                   background:${C.amber};transform:translateX(calc(-50% - 46px)) rotate(-9deg);
                   box-shadow:0 18px 44px rgba(9,45,60,.20);"></div>
       <div style="position:absolute;top:138px;left:50%;width:322px;height:452px;border-radius:44px;
                   background:${C.orange};transform:translateX(calc(-50% + 34px)) rotate(5deg);
                   box-shadow:0 18px 44px rgba(9,45,60,.20);"></div>
       <div style="position:absolute;top:104px;left:50%;transform:translateX(-50%) rotate(-1deg);">
         ${phone({ img, width: 306, crop: 0.58, ...LIGHT, shadow: '0 22px 50px rgba(9,45,60,.28)' })}
       </div>
     </div>`,
    `background:linear-gradient(160deg,#fffaf2 0%,#f1f9fc 100%);`,
  );

/** 4. dark — dark-theme device on the app's own dark background. */
const dark = (img: string) =>
  page(
    `<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;">
       ${phone({ img, width: 400, crop: 0.62, bezel: 11, radius: 54, ...DARK, shadow: `0 -6px 70px rgba(43,181,212,.22), 0 30px 70px rgba(0,0,0,.6)` })}
     </div>`,
    `background:
       radial-gradient(85% 50% at 50% 2%, rgba(43,181,212,.30) 0%, transparent 62%),
       linear-gradient(180deg,${C.bgDark} 0%,${C.cardDark} 100%);`,
  );

/** 5. duo — two tilted phones, back one peeking out. */
const duo = (back: string, front: string) =>
  page(
    `<div style="position:relative;width:100%;height:100%;">
       <div style="position:absolute;top:118px;left:50%;transform:translateX(calc(-50% + 118px)) rotate(7deg);">
         ${phone({ img: back, width: 268, crop: 0.82, ...LIGHT, shadow: '0 18px 44px rgba(9,45,60,.20)' })}
       </div>
       <div style="position:absolute;top:150px;left:50%;transform:translateX(calc(-50% - 92px)) rotate(-6deg);">
         ${phone({ img: front, width: 286, crop: 0.8, ...LIGHT, shadow: '0 24px 56px rgba(9,45,60,.28)' })}
       </div>
     </div>`,
    `background:
       radial-gradient(65% 55% at 82% 12%, ${C.orangeLight} 0%, transparent 60%),
       radial-gradient(70% 60% at 12% 88%, ${C.primaryLight} 0%, transparent 62%),
       linear-gradient(150deg,#f7fbfd 0%,#e8f5fa 100%);`,
  );

async function shot(browser: Browser, html: string, file: string) {
  const p = await browser.newPage({
    viewport: { width: 800, height: 800 },
    deviceScaleFactor: 1,
  });
  await p.setContent(html, { waitUntil: 'networkidle' });
  await p.waitForTimeout(120);
  await p.screenshot({ path: join(OUT, file) });
  await p.close();
  console.log(file);
}

async function main() {
  const b = await chromium.launch();
  if (process.env.SKIP_CAPTURE !== '1') await capture(b);
  await shot(b, soft(raw('home-light')), '01-soft-home.png');
  await shot(b, zoom(raw('stats-light')), '02-zoom-stats.png');
  await shot(b, cards(raw('custom-light')), '03-cards-add.png');
  await shot(b, dark(raw('chat-dark')), '04-dark-chat.png');
  await shot(
    b,
    duo(raw('languages-light'), raw('home-light')),
    '05-duo-languages-home.png',
  );
  await shot(b, soft(raw('languages-light')), '06-soft-languages.png');
  await b.close();
}
main().catch((err) => {
  console.error(err);
  process.exit(1);
});
