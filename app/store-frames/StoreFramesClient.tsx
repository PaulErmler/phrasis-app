'use client';

/**
 * Client half of the store-frames route (the page itself is a server
 * component so it can carry the dev-only guard + noindex metadata).
 *
 * Renders ONE store frame at the App Store's 6.9" iPhone size so a Playwright
 * viewport screenshot is upload-ready. The caption text is passed in by the
 * render script, so listing copy lives with the script rather than in the app.
 *
 *   /store-frames?screen=shadow&caption=SOME%20TEXT&sub=...&invert=1
 */
import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { StoreFrame, FRAME_W, FRAME_H, PAD_FRAME_W, PAD_FRAME_H } from './StoreFrame';
import { SCREENS } from './screens';

/** Designed frames that fill the whole canvas instead of sitting in a phone. */
const POSTERS = new Set(['pillars', 'modes']);

function Frame() {
  const params = useSearchParams();
  const screen = params.get('screen') ?? 'shadow';
  const caption = params.get('caption') ?? '';
  const bg = params.get('bg') ?? '#FFFFFF';
  const fg = params.get('fg') ?? '#0D1416';
  const bleed = params.get('bleed') === '1';
  const pad = params.get('pad') === '1';

  const render = SCREENS[screen];
  if (!render) {
    return <pre style={{ padding: 40, fontSize: 28 }}>Unknown screen: {screen}</pre>;
  }

  if (bleed || POSTERS.has(screen)) {
    return (
      <div
        data-store-frame
        style={{
          width: pad ? PAD_FRAME_W : FRAME_W,
          height: pad ? PAD_FRAME_H : FRAME_H,
          background: bg,
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <style>{`nextjs-portal,[data-nextjs-toast],[data-testid="consent-banner"],[data-sonner-toaster]{display:none!important}html,body{background:#fff}`}</style>
        {render()}
      </div>
    );
  }

  return (
    <StoreFrame
      caption={caption.split('|').map((line, i) => (
        <span key={i} style={{ display: 'block' }}>
          {line}
        </span>
      ))}
      bg={bg}
      fg={fg}
      bleed={bleed}
      pad={pad}
    >
      {render()}
    </StoreFrame>
  );
}

export function StoreFramesClient() {
  return (
    <Suspense fallback={null}>
      <Frame />
    </Suspense>
  );
}
