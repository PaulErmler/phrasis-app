'use client';

import type { ReactNode } from 'react';

/**
 * The store-screenshot frame, rendered at the App Store's 6.9" iPhone size
 * (1320x2868) so a Playwright viewport screenshot is upload-ready.
 *
 * The device holds a real 430x932pt phone viewport scaled up to fill it, so
 * the app components inside lay out exactly as they do on a handset. The
 * screen runs past the bottom edge on purpose.
 */
export const FRAME_W = 1320;
export const FRAME_H = 2868;
/** 13-inch iPad, the size App Store Connect requires for tablet. */
export const PAD_FRAME_W = 2064;
export const PAD_FRAME_H = 2752;

const PHONE = {
  logicalW: 390,
  logicalH: 845,
  deviceW: 1120,
  capFont: 92,
  capPad: '86px 76px 34px',
  radius: 76,
  bottom: 54,
};
const PAD = {
  logicalW: 820,
  logicalH: 1093,
  deviceW: 1620,
  capFont: 128,
  capPad: '150px 150px 60px',
  radius: 84,
  bottom: 90,
};

const HIDE_APP_CHROME = `
  nextjs-portal, [data-nextjs-toast], [data-testid="consent-banner"],
  [data-sonner-toaster], .Toaster { display: none !important; }
  html, body { background: #fff; }
`;

export function StoreFrame({
  caption,
  bg = '#FFFFFF',
  fg = '#0D1416',
  bleed = false,
  pad = false,
  children,
}: {
  /** Render at iPad size instead of iPhone. */
  pad?: boolean;
  /** One sentence. Pipe characters become line breaks. */
  caption?: ReactNode;
  /** Frame background. The set rotates terracotta, sky and amber. */
  bg?: string;
  /** Caption colour, picked for contrast against `bg`. */
  fg?: string;
  /** Skip the phone and let the content fill the whole frame. */
  bleed?: boolean;
  children: ReactNode;
}) {
  const D = pad ? PAD : PHONE;
  const SCALE = D.deviceW / D.logicalW;
  return (
    <div
      data-store-frame
      style={{
        width: pad ? PAD_FRAME_W : FRAME_W,
        height: pad ? PAD_FRAME_H : FRAME_H,
        background: bg,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <style>{HIDE_APP_CHROME}</style>

      {bleed ? (
        children
      ) : (
        <>
          <div style={{ flex: '0 0 auto', padding: D.capPad }}>
            <p
              style={{
                margin: 0,
                fontSize: D.capFont,
                lineHeight: 1.02,
                fontWeight: 800,
                letterSpacing: '-0.032em',
                textTransform: 'uppercase',
                color: fg,
                textWrap: 'balance',
              }}
            >
              {caption}
            </p>
          </div>

          <div
            style={{
              flex: '1 1 auto',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              overflow: 'hidden',
              paddingBottom: D.bottom,
            }}
          >
            <div
              style={{
                width: D.deviceW,
                height: D.logicalH * SCALE,
                flex: '0 0 auto',
                borderRadius: D.radius,
                border: '7px solid rgba(255,255,255,.4)',
                overflow: 'hidden',
                position: 'relative',
                boxShadow: '0 30px 90px rgba(0,0,0,.24)',
                background: 'var(--background)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: D.logicalW,
                  height: D.logicalH,
                  transform: `scale(${SCALE})`,
                  transformOrigin: 'top left',
                }}
              >
                {children}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * A whole app screen inside the phone. No status bar: store assets read
 * cleaner without a fake clock and signal bars.
 */
export function Screen({
  title,
  children,
  bodyClass = 'p-4',
  footer,
}: {
  title?: string;
  children: ReactNode;
  bodyClass?: string;
  footer?: ReactNode;
}) {
  return (
    <div className="absolute inset-0 flex flex-col bg-background text-foreground">
      {title && (
        <div className="flex-none border-b px-4 pb-3 pt-5 text-center text-xl font-semibold">
          {title}
        </div>
      )}
      <div
        className={`flex min-h-0 flex-1 flex-col gap-4 overflow-hidden ${bodyClass}`}
      >
        {children}
      </div>
      {footer && <div className="flex-none border-t px-4 py-3">{footer}</div>}
    </div>
  );
}

/** A designed marketing frame with no device: the opener and the mode card. */
export function Poster({ children, bg }: { children: ReactNode; bg?: string }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: bg,
        display: 'flex',
        flexDirection: 'column',
        padding: '110px 84px 100px',
      }}
    >
      {children}
    </div>
  );
}
