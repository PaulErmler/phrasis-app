'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Coachmark — spotlight + tooltip used to teach mechanics during the first
 * lesson. Renders a fixed-position dimmed overlay that "cuts out" the bounding
 * rect of the anchor element and renders a tooltip pointing at it.
 *
 * The cutout style is swappable via the `cutoutStyle` prop, exposed for
 * prototyping. The live onboarding passes a single constant (see
 * `app/app/onboarding/components/FirstLessonContainer.tsx`) so swapping the
 * style post-prototype is a one-line change.
 *
 * Coachmarks are sequenced by a parent `CoachmarkProvider`. Each `Coachmark`
 * registers itself by id; the provider shows them one at a time in the
 * declared order. A coachmark can be dismissed by tapping "Got it" or by
 * the underlying app reporting that the user completed the gated action
 * (`completeCoachmark(id)` on the context).
 */

export type CoachmarkCutoutStyle = 'sharp' | 'rounded' | 'soft';
export type CoachmarkPlacement = 'top' | 'bottom' | 'left' | 'right';

interface Coachmark {
  id: string;
  /** Either an explicit ref to the anchored element, or a DOM selector
   *  (e.g. `'[data-coachmark-anchor="rating-buttons"]'`) the overlay will
   *  resolve on mount. Selectors let callers target deep internals of
   *  third-party / large components without threading refs through. */
  anchor: RefObject<HTMLElement | null> | string;
  title?: string;
  body: ReactNode;
  placement?: CoachmarkPlacement;
  dismissLabel?: string;
}

interface CoachmarkContextValue {
  registerCoachmark(c: Coachmark): void;
  completeCoachmark(id: string): void;
  currentCoachmarkId: string | null;
}

const Ctx = createContext<CoachmarkContextValue | null>(null);

interface CoachmarkProviderProps {
  /** Coachmark ids in the order they should appear. Coachmarks not yet
   *  registered are skipped (then shown once they register). */
  order: string[];
  children: ReactNode;
  cutoutStyle?: CoachmarkCutoutStyle;
  /** Defaults to dark overlay — set to false to use a soft blur fallback only. */
  showOverlay?: boolean;
  /** Fires whenever a coachmark transitions into the visible position.
   *  OnboardingFirstLesson uses this to pause card audio while the user
   *  reads the tooltip. */
  onShowCoachmark?: (id: string) => void;
}

export function CoachmarkProvider({
  order,
  children,
  cutoutStyle = 'soft',
  showOverlay = true,
  onShowCoachmark,
}: CoachmarkProviderProps) {
  const [coachmarks, setCoachmarks] = useState<Record<string, Coachmark>>({});
  const [completed, setCompleted] = useState<Set<string>>(new Set());

  const registerCoachmark = useCallback((c: Coachmark) => {
    setCoachmarks((prev) => {
      if (prev[c.id] && prev[c.id].anchor === c.anchor && prev[c.id].body === c.body) {
        return prev;
      }
      return { ...prev, [c.id]: c };
    });
  }, []);

  const completeCoachmark = useCallback((id: string) => {
    setCompleted((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const currentCoachmarkId = useMemo(() => {
    for (const id of order) {
      if (completed.has(id)) continue;
      if (coachmarks[id]) return id;
      // If this coachmark isn't registered yet, wait — don't skip ahead.
      return null;
    }
    return null;
  }, [order, completed, coachmarks]);

  // Fire the show-hook whenever the visible coachmark id transitions to a
  // new non-null value (so the consumer can pause audio etc.).
  const lastShownRef = useRef<string | null>(null);
  useEffect(() => {
    if (currentCoachmarkId && currentCoachmarkId !== lastShownRef.current) {
      lastShownRef.current = currentCoachmarkId;
      onShowCoachmark?.(currentCoachmarkId);
    }
  }, [currentCoachmarkId, onShowCoachmark]);

  const ctx: CoachmarkContextValue = useMemo(
    () => ({ registerCoachmark, completeCoachmark, currentCoachmarkId }),
    [registerCoachmark, completeCoachmark, currentCoachmarkId],
  );

  const current = currentCoachmarkId ? coachmarks[currentCoachmarkId] : null;

  return (
    <Ctx.Provider value={ctx}>
      {children}
      {current ? (
        <CoachmarkOverlay
          key={current.id}
          coachmark={current}
          cutoutStyle={cutoutStyle}
          showOverlay={showOverlay}
          onDismiss={() => completeCoachmark(current.id)}
        />
      ) : null}
    </Ctx.Provider>
  );
}

function useCoachmarks(): CoachmarkContextValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCoachmarks must be used within a CoachmarkProvider');
  return ctx;
}

/**
 * Register a coachmark by id, attached to the given anchor ref. The parent
 * `CoachmarkProvider` decides when to actually show it. Returns a `complete`
 * helper if the caller wants to dismiss it programmatically (e.g. once the
 * user performs the action being taught).
 */
export function useRegisterCoachmark(coachmark: Coachmark): { complete: () => void } {
  const { registerCoachmark, completeCoachmark } = useCoachmarks();

  useEffect(() => {
    registerCoachmark(coachmark);
    // Anchor may be a stable ref or a string selector — both are valid
    // dependency keys here. Body/title may be a ReactNode (not deeply
    // comparable), so we register on every render — the provider dedupes
    // by reference equality on `anchor` and `body`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [coachmark.id, coachmark.anchor, coachmark.body, coachmark.title, coachmark.placement]);

  return { complete: useCallback(() => completeCoachmark(coachmark.id), [completeCoachmark, coachmark.id]) };
}

// ─── Overlay rendering ──────────────────────────────────────────────────────

const CUTOUT_PADDING = 8;

function CoachmarkOverlay({
  coachmark,
  cutoutStyle,
  showOverlay,
  onDismiss,
}: {
  coachmark: Coachmark;
  cutoutStyle: CoachmarkCutoutStyle;
  showOverlay: boolean;
  onDismiss: () => void;
}) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useLayoutEffect(() => {
    // Resolve the anchor element from either a ref or a selector. Selectors
    // are re-queried whenever the anchor changes; the mutation observer
    // below picks up later mounts (e.g. the rating buttons appearing once
    // the FSRS phase begins).
    const resolveEl = (): HTMLElement | null => {
      if (typeof coachmark.anchor === 'string') {
        return document.querySelector<HTMLElement>(coachmark.anchor);
      }
      return coachmark.anchor.current;
    };

    let el = resolveEl();

    const update = () => {
      if (!el) return;
      setRect(el.getBoundingClientRect());
    };

    const observer = new ResizeObserver(update);
    if (el) observer.observe(el);
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    const raf = requestAnimationFrame(update);

    // Selector anchors: poll the DOM via a MutationObserver so we pick up
    // the element when it eventually mounts (e.g. rating buttons appearing
    // after FSRS phase begins).
    let mo: MutationObserver | null = null;
    if (typeof coachmark.anchor === 'string' && !el) {
      mo = new MutationObserver(() => {
        const next = resolveEl();
        if (next && next !== el) {
          el = next;
          observer.observe(next);
          update();
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    update();

    return () => {
      observer.disconnect();
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
      cancelAnimationFrame(raf);
      mo?.disconnect();
    };
  }, [coachmark.anchor]);

  // Keyboard navigation:
  //   Enter / Space / Right Arrow  → advance to the next coachmark (dismiss)
  //   Left Arrow                   → no-op (sequence is forward-only)
  //   Escape                       → also dismiss (acts as "skip this one")
  // Bound at the window level so the user doesn't need to focus a particular
  // element first — the coachmark is the active UI by visual prominence.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
      case 'Enter':
      case ' ':           // Space
      case 'Spacebar':    // legacy
      case 'ArrowRight':
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
        break;
      default:
        break;
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onDismiss, coachmark.id]);

  if (!mounted || !rect) return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {showOverlay ? (
        <CutoutOverlay rect={rect} style={cutoutStyle} onClick={onDismiss} />
      ) : null}
      <Highlight rect={rect} style={cutoutStyle} />
      <Tooltip
        rect={rect}
        title={coachmark.title}
        body={coachmark.body}
        placement={coachmark.placement ?? 'bottom'}
        dismissLabel={coachmark.dismissLabel ?? 'Got it'}
        onDismiss={onDismiss}
      />
    </div>,
    document.body,
  );
}

function CutoutOverlay({
  rect,
  style,
  onClick,
}: {
  rect: DOMRect;
  style: CoachmarkCutoutStyle;
  onClick: () => void;
}) {
  // Use SVG mask to cut the anchor rect out of a dimmed full-screen rect.
  const pad = CUTOUT_PADDING;
  const r = style === 'sharp' ? 0 : style === 'rounded' ? 12 : 20;
  const cutoutOpacity = style === 'soft' ? 0.5 : 0.65;

  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-auto"
      onClick={onClick}
      aria-hidden
    >
      <defs>
        <mask id="coachmark-cutout">
          <rect width="100%" height="100%" fill="white" />
          <rect
            x={rect.left - pad}
            y={rect.top - pad}
            width={rect.width + pad * 2}
            height={rect.height + pad * 2}
            rx={r}
            ry={r}
            fill="black"
          />
        </mask>
      </defs>
      <rect
        width="100%"
        height="100%"
        fill="rgba(0,0,0,1)"
        opacity={cutoutOpacity}
        mask="url(#coachmark-cutout)"
      />
    </svg>
  );
}

function Highlight({ rect, style }: { rect: DOMRect; style: CoachmarkCutoutStyle }) {
  const pad = CUTOUT_PADDING;
  return (
    <div
      className={cn(
        'absolute border-2 border-primary pointer-events-none',
        style === 'sharp' && 'rounded-none',
        style === 'rounded' && 'rounded-lg',
        style === 'soft' && 'rounded-2xl shadow-[0_0_0_8px_rgba(var(--primary),0.18)]',
      )}
      style={{
        left: rect.left - pad,
        top: rect.top - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }}
    />
  );
}

function Tooltip({
  rect,
  title,
  body,
  placement,
  dismissLabel,
  onDismiss,
}: {
  rect: DOMRect;
  title?: string;
  body: ReactNode;
  placement: CoachmarkPlacement;
  dismissLabel: string;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const dismissBtnRef = useRef<HTMLButtonElement | null>(null);
  const [tooltipSize, setTooltipSize] = useState<{ w: number; h: number } | null>(null);

  // Auto-focus the dismiss button on mount so Enter/Space work naturally
  // even without the window-level key handler firing.
  useEffect(() => {
    const t = setTimeout(() => dismissBtnRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const { width, height } = ref.current.getBoundingClientRect();
    if (!tooltipSize || tooltipSize.w !== width || tooltipSize.h !== height) {
      setTooltipSize({ w: width, h: height });
    }
  });

  const tw = tooltipSize?.w ?? 280;
  const th = tooltipSize?.h ?? 100;
  const gap = 16;
  const vw = typeof window === 'undefined' ? 1000 : window.innerWidth;
  const vh = typeof window === 'undefined' ? 800 : window.innerHeight;

  let pos: CoachmarkPlacement = placement;
  // Auto-flip if there isn't room.
  if (pos === 'bottom' && rect.bottom + gap + th > vh - 12) pos = 'top';
  if (pos === 'top' && rect.top - gap - th < 12) pos = 'bottom';
  if (pos === 'right' && rect.right + gap + tw > vw - 12) pos = 'left';
  if (pos === 'left' && rect.left - gap - tw < 12) pos = 'right';

  let left: number;
  let top: number;
  if (pos === 'bottom') {
    left = rect.left + rect.width / 2 - tw / 2;
    top = rect.bottom + gap;
  } else if (pos === 'top') {
    left = rect.left + rect.width / 2 - tw / 2;
    top = rect.top - gap - th;
  } else if (pos === 'right') {
    left = rect.right + gap;
    top = rect.top + rect.height / 2 - th / 2;
  } else {
    left = rect.left - gap - tw;
    top = rect.top + rect.height / 2 - th / 2;
  }

  left = Math.max(12, Math.min(left, vw - tw - 12));
  top = Math.max(12, Math.min(top, vh - th - 12));

  return (
    <div
      ref={ref}
      role="dialog"
      className="absolute pointer-events-auto rounded-xl bg-popover text-popover-foreground shadow-xl border p-4 max-w-[320px]"
      style={{ left, top, width: 280 }}
    >
      {title ? <div className="font-semibold mb-1">{title}</div> : null}
      <div className="text-sm leading-snug">{body}</div>
      <div className="mt-3 flex justify-end">
        <Button ref={dismissBtnRef} size="sm" onClick={onDismiss}>
          {dismissLabel}
        </Button>
      </div>
    </div>
  );
}
