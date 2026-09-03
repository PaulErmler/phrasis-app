/**
 * Store screenshot & marketing asset pipeline.
 *
 * 1. Captures the mock screens at /screenshots/[screen] (real components,
 *    mocked data) with Playwright at device resolution.
 * 2. Composes FIVE style series for the App Store (1320×2868 each) so they
 *    can be compared side by side:
 *      classic: full device in frame, caption on top (safe baseline)
 *      zoom: oversized device cropped at the bottom → much larger UI
 *      panorama: continuous background + connector line spanning all five
 *                  frames, tilted devices with neighbors peeking in
 *      minimal: no device frame, screenshot full-bleed under a caption band
 *      cards: the logo's stacked-flashcards motif: the phone as the
 *                  front card of a fanned pile in the logo's colors
 *    Design grounding (2026 ASO guidance): first 1–3 frames decide installs,
 *    captions must be huge and outcome-framed, cropped/zoomed devices beat
 *    full-device frames for legibility, panoramas only work when every frame
 *    still stands alone.
 * 3. Renders the Play set (classic style, 1080×1920), the feature graphic
 *    (1024×500) and the store icons.
 *
 * Usage:
 *   pnpm dev            # in one terminal (or set BASE_URL)
 *   pnpm store:assets   # in another
 *
 * Output: store-assets/series/<style>/ (iOS), store-assets/android/,
 *         store-assets/common/
 */

import { chromium, type Browser } from '@playwright/test';
import sharp from 'sharp';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CAPTURE_VIEWPORT as CAPTURE,
  captureScreen,
} from './lib/captureScreens';

const BASE_URL = process.env.BASE_URL ?? 'http://localhost:3000';
const OUT = join(process.cwd(), 'store-assets');
const RAW = join(OUT, 'raw');

const SCREEN_ASPECT = CAPTURE.height / CAPTURE.width;

const IOS = { width: 1320, height: 2868 };
const ANDROID = { width: 1080, height: 1920 };

interface ScreenSpec {
  slug: string;
  headline: string;
  subline: string;
  theme: 'dark' | 'light';
  settleMs?: number;
}

/**
 * Copy principles: the headline sells an outcome in ≤4 words; the concrete
 * facts (20k sentences, 59 languages, four skills…) are the PROOF and live in
 * the subline. Ordered as a story arc: promise → breadth → personal →
 * method → depth → lifestyle → simplicity → social proof.
 */
const SCREENS: ScreenSpec[] = [
  {
    slug: 'home',
    headline: 'Vocabulary building made easy.',
    subline:
      '20,000 sentences sorted by difficulty — the 10,000 most common words, learned in order.',
    theme: 'dark',
  },
  {
    slug: 'languages',
    headline: 'Your language is here.',
    subline: '59 languages and dialects, each with natural-sounding audio.',
    theme: 'dark',
  },
  {
    slug: 'custom',
    headline: 'Built around your life.',
    subline:
      'Add the sentences you’ll actually say — AI handles translation and audio.',
    theme: 'dark',
  },
  {
    slug: 'review',
    headline: 'Speak from day one.',
    subline:
      'Shadow native speakers hands-free — on your commute, your run, your couch.',
    theme: 'dark',
  },
  {
    slug: 'writing',
    headline: 'Every skill, trained.',
    subline:
      'Listening, speaking, translation, transcription — with instant feedback.',
    theme: 'dark',
  },
  {
    slug: 'radio',
    headline: 'Immersion on tap.',
    subline:
      'Radio mode streams your sentences like a podcast — comprehensible input all day.',
    theme: 'dark',
  },
  {
    slug: 'chat',
    headline: 'One app, not five.',
    subline:
      'Ask the AI tutor anything — answers become flashcards, ready to practice.',
    theme: 'dark',
  },
  {
    slug: 'testimonials',
    headline: 'Don’t take our word for it.',
    subline: 'Real reviews from the language-learning community.',
    theme: 'dark',
  },
];

/**
 * Real product colors only: backgrounds/text are the app's dark-theme tokens
 * (globals.css oklch values resolved to sRGB), accents are sampled from the
 * logo's stacked flashcards.
 */
const BRAND = {
  bgTop: '#0a0a0a', //   --background (dark)
  bgBottom: '#171717', // --card (dark)
  accent: '#2bb5d4', //  --primary
  text: '#fafafa', //    --foreground (dark)
  subtext: '#b5b5b5', // --muted-foreground (dark), lightened for 40px captions
};

/** Logo card-stack palette (sampled from assets/logo.png). */
const LOGO = {
  cyan: '#30c0d8',
  orange: '#d86030',
  amber: '#ffa800',
};

const accentGlow = (a: number) => `rgba(43,181,212,${a})`;

function statusBarSvg(fg: string): string {
  return `
    <div style="display:flex;align-items:center;justify-content:space-between;height:100%;padding:0 28px;color:${fg};font-weight:600;font-size:22px;">
      <span>9:41</span>
      <span style="display:flex;gap:10px;align-items:center;">
        <svg width="24" height="16" viewBox="0 0 24 16" fill="currentColor"><rect x="0" y="10" width="4" height="6" rx="1"/><rect x="6" y="7" width="4" height="9" rx="1"/><rect x="12" y="4" width="4" height="12" rx="1"/><rect x="18" y="1" width="4" height="15" rx="1"/></svg>
        <svg width="30" height="16" viewBox="0 0 30 16" fill="none" stroke="currentColor"><rect x="1" y="2" width="24" height="12" rx="3.5" stroke-width="1.5"/><rect x="3.5" y="4.5" width="17" height="7" rx="1.5" fill="currentColor" stroke="none"/><path d="M27.5 6v4a2.2 2.2 0 0 0 0-4z" fill="currentColor" stroke="none"/></svg>
      </span>
    </div>`;
}

interface ComposeCtx {
  index: number;
  spec: ScreenSpec;
  width: number;
  height: number;
  /** Data URIs of all five raw captures, in order. */
  raws: string[];
  statusBg: string;
  statusFg: string;
}

const PAGE_BASE = (width: number, height: number) => `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: ${width}px; height: ${height}px; overflow: hidden; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif; }
`;

/** Device frame markup shared by the styles that show a phone. */
function device(opts: {
  width: number;
  raw: string;
  statusBg: string;
  statusFg: string;
  radius?: number;
  bezel?: number;
  contain?: boolean; // full rounded rect, explicit height
  extraStyle?: string;
}): string {
  const bezel = opts.bezel ?? 22;
  const radius = opts.radius ?? 110;
  const statusH = 96;
  const screenH = Math.round((opts.width - 2 * bezel) * SCREEN_ASPECT);
  const height = opts.contain
    ? `height:${2 * bezel + statusH + screenH}px;`
    : '';
  const rounding = opts.contain
    ? `border-radius:${radius}px;`
    : `border-radius:${radius}px ${radius}px 0 0;border-bottom:none;`;
  return `
    <div style="width:${opts.width}px;${height}background:#050708;border:${bezel}px solid #1f2733;${rounding}
                box-shadow:0 -8px 120px ${accentGlow(0.16)}, 0 40px 120px rgba(0,0,0,0.6);
                overflow:hidden;display:flex;flex-direction:column;flex-shrink:0;${opts.extraStyle ?? ''}">
      <div style="height:${statusH}px;background:${opts.statusBg};flex-shrink:0;">${statusBarSvg(opts.statusFg)}</div>
      <div style="flex:1;overflow:hidden;"><img src="${opts.raw}" style="width:100%;display:block;" /></div>
    </div>`;
}

function caption(
  ctx: ComposeCtx,
  opts?: { align?: 'center' | 'left'; padTop?: number },
): string {
  const align = opts?.align ?? 'center';
  const padTop = opts?.padTop ?? 130;
  return `
    <div style="padding:${padTop}px ${align === 'left' ? '96px' : '90px'} 0;text-align:${align};">
      <div style="color:${BRAND.text};font-size:84px;font-weight:800;letter-spacing:-0.02em;line-height:1.12;">
        ${ctx.spec.headline.replace(/\.$/, `<span style="color:${BRAND.accent}">.</span>`)}
      </div>
      <div style="margin-top:32px;color:${BRAND.subtext};font-size:40px;font-weight:500;line-height:1.35;${align === 'center' ? 'padding:0 40px;' : ''}">
        ${ctx.spec.subline}
      </div>
    </div>`;
}

const DARK_BG = `
  background:
    radial-gradient(120% 55% at 50% -8%, ${accentGlow(0.22)}, transparent 60%),
    linear-gradient(180deg, ${BRAND.bgTop} 0%, ${BRAND.bgBottom} 100%);
`;

// ── Style composers ─────────────────────────────────────────────────────────

/** classic: whole phone visible at true proportions (safe baseline). */
function composeClassic(ctx: ComposeCtx): string {
  return `<!DOCTYPE html><html><head><style>${PAGE_BASE(ctx.width, ctx.height)}
    body { ${DARK_BG} display:flex;flex-direction:column;align-items:center; }
  </style></head><body>
    ${caption(ctx)}
    <div style="margin-top:64px;display:flex;justify-content:center;">
      ${device({ width: 1000, raw: ctx.raws[ctx.index], statusBg: ctx.statusBg, statusFg: ctx.statusFg, contain: true })}
    </div>
  </body></html>`;
}

/** zoom: oversized phone cropped at the canvas bottom → much larger UI. */
function composeZoom(ctx: ComposeCtx): string {
  return `<!DOCTYPE html><html><head><style>${PAGE_BASE(ctx.width, ctx.height)}
    body { ${DARK_BG} display:flex;flex-direction:column;align-items:center; }
  </style></head><body>
    ${caption(ctx)}
    <div style="margin-top:72px;display:flex;justify-content:center;">
      ${device({ width: 1180, raw: ctx.raws[ctx.index], statusBg: ctx.statusBg, statusFg: ctx.statusFg })}
    </div>
  </body></html>`;
}

/**
 * panorama: one continuous scene sliced into five frames. A background
 * gradient and a dashed connector line run through all of them, neighbor
 * devices peek in at the edges. Every frame still carries its own caption.
 */
function composePanorama(ctx: ComposeCtx): string {
  const total = SCREENS.length;
  const fullW = ctx.width * total;
  const offset = -ctx.index * ctx.width;
  const deviceW = 1130;
  const deviceTop = 850;
  const lineY = 700;
  // Connector: dashed line with a numbered node above each slide's device;
  // node colors cycle through the logo's card palette.
  const nodeColor = (i: number) => [LOGO.cyan, LOGO.orange, LOGO.amber][i % 3];
  const nodes = SCREENS.map((_, i) => {
    const cx = i * ctx.width + ctx.width / 2;
    return `
      <circle cx="${cx}" cy="${lineY}" r="34" fill="${BRAND.bgTop}" stroke="${nodeColor(i)}" stroke-width="6"/>
      <text x="${cx}" y="${lineY + 14}" text-anchor="middle" font-family="-apple-system,Helvetica" font-size="38" font-weight="700" fill="${nodeColor(i)}">${i + 1}</text>`;
  }).join('');
  const neighbor = (i: number, side: 'left' | 'right') =>
    i < 0 || i >= total
      ? ''
      : `<div style="position:absolute;top:${deviceTop + 60}px;${side}:-${deviceW - 100}px;transform:rotate(-5deg);opacity:0.92;">
           ${device({ width: deviceW, raw: ctx.raws[i], statusBg: ctx.statusBg, statusFg: ctx.statusFg })}
         </div>`;
  return `<!DOCTYPE html><html><head><style>${PAGE_BASE(ctx.width, ctx.height)}
    body { position:relative; background:${BRAND.bgTop}; overflow:hidden; }
  </style></head><body>
    <div style="position:absolute;left:${offset}px;top:0;width:${fullW}px;height:100%;
                background:
                  radial-gradient(40% 30% at ${((ctx.width / 2 - offset) / fullW) * 100}% 12%, ${accentGlow(0.25)}, transparent 70%),
                  linear-gradient(100deg, ${BRAND.bgTop} 0%, #0e1b24 22%, ${BRAND.bgBottom} 48%, #0c141c 74%, ${BRAND.bgTop} 100%);"></div>
    <svg style="position:absolute;left:${offset}px;top:0;" width="${fullW}" height="${ctx.height}">
      <line x1="0" y1="${lineY}" x2="${fullW}" y2="${lineY}" stroke="${BRAND.accent}" stroke-width="5" stroke-dasharray="4 36" stroke-linecap="round" opacity="0.75"/>
      ${nodes}
    </svg>
    <div style="position:relative;">${caption(ctx, { padTop: 150 })}</div>
    ${neighbor(ctx.index - 1, 'left')}
    ${neighbor(ctx.index + 1, 'right')}
    <div style="position:absolute;top:${deviceTop}px;left:50%;transform:translateX(-50%) rotate(-5deg);">
      ${device({ width: deviceW, raw: ctx.raws[ctx.index], statusBg: ctx.statusBg, statusFg: ctx.statusFg })}
    </div>
  </body></html>`;
}

/** minimal: no bezel. The app itself, full-bleed under a caption band. */
function composeMinimal(ctx: ComposeCtx): string {
  return `<!DOCTYPE html><html><head><style>${PAGE_BASE(ctx.width, ctx.height)}
    body { ${DARK_BG} display:flex;flex-direction:column; }
  </style></head><body>
    <div style="flex-shrink:0;">${caption(ctx, { padTop: 120 })}</div>
    <div style="margin-top:88px;flex:1;overflow:hidden;border-radius:56px 56px 0 0;
                box-shadow:0 -12px 90px rgba(0,0,0,0.55), 0 0 0 2px rgba(255,255,255,0.07);">
      <img src="${ctx.raws[ctx.index]}" style="width:100%;display:block;" />
    </div>
  </body></html>`;
}

/**
 * cards: the logo's own motif. The phone is the front card of a stacked
 * flashcard pile, with the logo's amber and orange cards fanned out behind
 * it. The headline accent dot cycles the stack's colors across the series.
 */
function composeCards(ctx: ComposeCtx): string {
  const dot = [LOGO.cyan, LOGO.orange, LOGO.amber][ctx.index % 3];
  const deviceW = 1080;
  const cardW = deviceW + 40;
  const cardH = 2100;
  const cardTop = 780;
  const card = (
    color: string,
    rotate: number,
    offsetX: number,
    offsetY: number,
  ) => `
    <div style="position:absolute;top:${cardTop + offsetY}px;left:50%;width:${cardW}px;height:${cardH}px;
                transform:translateX(calc(-50% + ${offsetX}px)) rotate(${rotate}deg);
                background:${color};border-radius:96px;
                box-shadow:0 40px 100px rgba(0,0,0,0.45);"></div>`;
  return `<!DOCTYPE html><html><head><style>${PAGE_BASE(ctx.width, ctx.height)}
    body { position:relative; overflow:hidden;
           background: linear-gradient(180deg, ${BRAND.bgTop} 0%, ${BRAND.bgBottom} 100%); }
  </style></head><body>
    <div style="position:relative;z-index:2;padding:130px 90px 0;text-align:center;">
      <div style="color:${BRAND.text};font-size:84px;font-weight:800;letter-spacing:-0.02em;line-height:1.12;">
        ${ctx.spec.headline.replace(/\.$/, `<span style="color:${dot}">.</span>`)}
      </div>
      <div style="margin-top:32px;color:${BRAND.subtext};font-size:40px;font-weight:500;line-height:1.35;padding:0 40px;">
        ${ctx.spec.subline}
      </div>
    </div>
    ${card(LOGO.amber, -13, -130, 100)}
    ${card(LOGO.orange, -6, 90, 35)}
    <div style="position:absolute;top:${cardTop}px;left:50%;transform:translateX(-50%) rotate(1.5deg);z-index:1;">
      ${device({ width: deviceW, raw: ctx.raws[ctx.index], statusBg: ctx.statusBg, statusFg: ctx.statusFg, radius: 96 })}
    </div>
  </body></html>`;
}

const STYLES: Record<string, (ctx: ComposeCtx) => string> = {
  classic: composeClassic,
  zoom: composeZoom,
  panorama: composePanorama,
  minimal: composeMinimal,
  cards: composeCards,
};

// ── Static assets ───────────────────────────────────────────────────────────

function featureGraphicHtml(logoDataUri: string): string {
  return `<!DOCTYPE html><html><head><style>${PAGE_BASE(1024, 500)}
  body {
    background:
      radial-gradient(90% 130% at 85% 20%, ${accentGlow(0.3)}, transparent 60%),
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
    <p>Vocabulary building made <span class="accent">easy</span> —<br/>audio flashcards, big sentence library &amp; AI.</p>
  </div>
</body></html>`;
}

async function renderHtml(
  browser: Browser,
  html: string,
  width: number,
  height: number,
  outFile: string,
) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 1,
  });
  await page.setContent(html, { waitUntil: 'networkidle' });
  await page.waitForTimeout(150);
  await page.screenshot({ path: outFile });
  await page.close();
}

async function main() {
  const dirs = [OUT, RAW, join(OUT, 'android'), join(OUT, 'common')];
  for (const style of Object.keys(STYLES))
    dirs.push(join(OUT, 'series', style));
  for (const dir of dirs) mkdirSync(dir, { recursive: true });

  try {
    await fetch(`${BASE_URL}/screenshots/home`, { method: 'HEAD' });
  } catch {
    console.error(
      `Cannot reach ${BASE_URL} — start the app first (pnpm dev) or set BASE_URL.`,
    );
    process.exit(1);
  }

  const browser = await chromium.launch();

  // ---- 1. Raw captures --------------------------------------------------
  for (const spec of SCREENS) {
    const rawPath = join(RAW, `${spec.slug}-${spec.theme}.png`);
    await captureScreen(browser, {
      slug: spec.slug,
      theme: spec.theme,
      outPath: rawPath,
      baseUrl: BASE_URL,
      settleMs: spec.settleMs ?? 500,
    });
    console.log(`raw: ${rawPath}`);
  }

  const rawBuffers = SCREENS.map((s) =>
    readFileSync(join(RAW, `${s.slug}-${s.theme}.png`)),
  );
  const raws = rawBuffers.map(
    (b) => `data:image/png;base64,${b.toString('base64')}`,
  );

  // Status-bar color sampled from the first capture (all screens share the
  // app background).
  const { data } = await sharp(rawBuffers[0])
    .raw()
    .toBuffer({ resolveWithObject: true });
  const [r, g, b] = [data[0], data[1], data[2]];
  const statusBg = `rgb(${r},${g},${b})`;
  const statusFg =
    r * 0.299 + g * 0.587 + b * 0.114 > 140 ? '#111827' : '#f0f6fc';

  // ---- 2. iOS: five style series ----------------------------------------
  for (const [style, compose] of Object.entries(STYLES)) {
    for (const [i, spec] of SCREENS.entries()) {
      const html = compose({
        index: i,
        spec,
        width: IOS.width,
        height: IOS.height,
        raws,
        statusBg,
        statusFg,
      });
      const outFile = join(
        OUT,
        'series',
        style,
        `${String(i + 1).padStart(2, '0')}-${spec.slug}.png`,
      );
      await renderHtml(browser, html, IOS.width, IOS.height, outFile);
      console.log(`${style}: ${outFile}`);
    }
  }

  // ---- 3. Android (classic style at Play size) ---------------------------
  for (const [i, spec] of SCREENS.entries()) {
    const html = composeZoom({
      index: i,
      spec,
      width: ANDROID.width,
      height: ANDROID.height,
      raws,
      statusBg,
      statusFg,
    });
    const outFile = join(
      OUT,
      'android',
      `${String(i + 1).padStart(2, '0')}-${spec.slug}.png`,
    );
    await renderHtml(browser, html, ANDROID.width, ANDROID.height, outFile);
    console.log(`android: ${outFile}`);
  }

  // ---- 4. Icons + feature graphic ---------------------------------------
  const logo = readFileSync(join(process.cwd(), 'assets', 'logo.png'));
  const iconOn = async (px: number, file: string) => {
    const inner = await sharp(logo)
      .resize(Math.round(px * 0.82), Math.round(px * 0.82), {
        fit: 'contain',
        background: { r: 255, g: 255, b: 255, alpha: 0 },
      })
      .png()
      .toBuffer();
    await sharp({
      create: { width: px, height: px, channels: 3, background: '#ffffff' },
    })
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
  console.log(
    `\nAll assets in ${OUT} — pick a series from store-assets/series/`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
