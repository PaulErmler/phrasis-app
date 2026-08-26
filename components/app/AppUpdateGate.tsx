'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

/**
 * Detects that a newer frontend build is deployed and gets the tab onto it.
 *
 * Next 16 already hard-navigates a stale tab whenever it makes an RSC fetch
 * (build-ID mismatch -> doMpaNavigation). That guard almost never fires here:
 * the /app shell switches tabs with raw `history.pushState` rather than the Next
 * router, and every view is statically imported into one bundle (no
 * `next/dynamic`, no `await import()`), so a learner can use the whole app for
 * days without a single RSC fetch. Installed PWA sessions make that worse.
 *
 * Three tiers, in order of preference:
 *   1. Silent reload when the tab returns from being hidden long enough and
 *      nothing is in flight: indistinguishable from a slow tab wake.
 *   2. A dismissible toast with a Reload button, but only once an update has
 *      been pending for a while with no safe moment to take it.
 *   3. A one-shot guarded reload if a chunk actually fails to load.
 *
 * Detection is focus-driven, not polled, mirroring BillingGate ("Focus-driven
 * rather than an interval: no polling, no cron"). `visibilitychange` also fires
 * on desktop tab switches, so the only uncovered case is a tab that stays
 * foregrounded forever.
 */

/**
 * Opt-in for the timing overrides below, so the silent-reload and escalation
 * paths can be exercised without waiting minutes or an hour:
 *
 *   NEXT_PUBLIC_UPDATE_DEBUG=1 NEXT_PUBLIC_UPDATE_HIDDEN_MS=3000 \
 *     NEXT_PUBLIC_UPDATE_ESCALATE_MS=5000 pnpm dev
 *
 * Deliberately a flag of its own rather than a `NODE_ENV !== 'production'`
 * check. Every deployed build. Staging included. Is a production build, so
 * keying on NODE_ENV made the one environment that most needs to verify this
 * behaviour the one environment that could not. Shortening the windows is not a
 * capability worth protecting: the worst it can do is reload sooner.
 */
const UPDATE_DEBUG = process.env.NEXT_PUBLIC_UPDATE_DEBUG === '1';

function tunableMs(raw: string | undefined, fallback: number): number {
  if (!UPDATE_DEBUG || !raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** How long the tab must have been hidden before a silent reload is harmless. */
const HIDDEN_LONG_ENOUGH_MS = tunableMs(
  process.env.NEXT_PUBLIC_UPDATE_HIDDEN_MS,
  10 * 60 * 1000,
);

/** How long an update may stay pending before we surface the toast. */
const ESCALATE_AFTER_MS = tunableMs(
  process.env.NEXT_PUBLIC_UPDATE_ESCALATE_MS,
  60 * 60 * 1000,
);

/**
 * At most one silent reload per target build per tab. If we reloaded toward a
 * build and came back still running the old one, something upstream is serving
 * a stale document and trying again will not fix it, no time window makes that
 * false, so this is a flat one-shot rather than a cooldown. The toast still
 * escalates afterwards, so a transiently failed reload is not a dead end.
 */
const RELOAD_ATTEMPT_KEY = 'app-update:reload-attempt';
const CHUNK_RELOAD_KEY = 'app-update:chunk-reload';
const TOAST_ID = 'app-update';

const CHUNK_ERROR_PATTERN =
  /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module|Importing a module script failed/i;

/** The build this bundle was compiled from. Inlined by next.config.ts. */
export const BUILD_ID = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev';

type ReloadBlockContextValue = {
  block: () => void;
  unblock: () => void;
};

const ReloadBlockContext = createContext<ReloadBlockContextValue | null>(null);

/**
 * Holds off the silent reload while something un-resumable is in flight. A
 * review session, audio playback, a dirty form, a streaming chat response.
 *
 * This has to be registered from the hook tree rather than sniffed from the
 * DOM: `useAudioPlayer` plays through a detached `new Audio()` that is never
 * attached to the document, so a `querySelectorAll('audio')` scan would miss it.
 *
 * Safe to call outside the provider (no-ops), so blocking components stay
 * usable in isolation and in tests.
 */
export function useReloadBlock(active: boolean) {
  const ctx = useContext(ReloadBlockContext);

  useEffect(() => {
    if (!ctx || !active) return;
    ctx.block();
    return () => ctx.unblock();
  }, [ctx, active]);
}

/** The build a silent reload was already attempted toward in this tab, if any. */
function readReloadAttempt(): string | null {
  try {
    return sessionStorage.getItem(RELOAD_ATTEMPT_KEY);
  } catch {
    // Private mode or disabled storage. Treat as no attempt.
    return null;
  }
}

function writeReloadAttempt(toBuildId: string) {
  try {
    sessionStorage.setItem(RELOAD_ATTEMPT_KEY, toBuildId);
  } catch {
    // Storage unavailable, so the loop guard is gone. Reload anyway: an
    // occasional double reload beats never getting off a stale bundle.
  }
}

export function AppUpdateGate({ children }: { children: React.ReactNode }) {
  const t = useTranslations('AppUpdate');

  const blockCountRef = useRef(0);
  const contextValue = useMemo<ReloadBlockContextValue>(
    () => ({
      block: () => {
        blockCountRef.current += 1;
      },
      unblock: () => {
        blockCountRef.current = Math.max(0, blockCountRef.current - 1);
      },
    }),
    [],
  );

  /** Timestamp of the last transition to hidden, or null while visible. */
  const hiddenSinceRef = useRef<number | null>(null);
  /** When we first saw this update, for the escalation timer. */
  const pendingSinceRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  /** Set once the toast has been shown, so a dismissal sticks. */
  const escalatedRef = useRef(false);

  const [latestBuildId, setLatestBuildId] = useState<string | null>(null);
  const updateAvailable = latestBuildId !== null && latestBuildId !== BUILD_ID;

  const reload = useCallback((toBuildId: string) => {
    writeReloadAttempt(toBuildId);
    window.location.reload();
  }, []);

  /**
   * @param hiddenForMs how long the tab was hidden immediately before this
   *   check, or 0 if it never went away. Only a long absence justifies pulling
   *   the page out from under the user without asking.
   */
  const check = useCallback(
    async (hiddenForMs: number) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;

      let buildId: string;
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { buildId?: unknown };
        if (typeof body.buildId !== 'string') return;
        buildId = body.buildId;
      } catch {
        // Offline, or the endpoint is unreachable. Fail open. A network error
        // is not a new version.
        return;
      } finally {
        inFlightRef.current = false;
      }

      setLatestBuildId(buildId);
      if (buildId === BUILD_ID) {
        pendingSinceRef.current = null;
        return;
      }

      pendingSinceRef.current ??= Date.now();

      if (blockCountRef.current > 0) return;
      if (hiddenForMs < HIDDEN_LONG_ENOUGH_MS) return;

      // We already tried to get onto this build and are somehow still here.
      if (readReloadAttempt() === buildId) return;

      reload(buildId);
    },
    [reload],
  );

  // Detection: mount, return-to-visible, and regaining connectivity.
  useEffect(() => {
    void check(0);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenSinceRef.current = Date.now();
        return;
      }
      const hiddenSince = hiddenSinceRef.current;
      hiddenSinceRef.current = null;
      void check(hiddenSince === null ? 0 : Date.now() - hiddenSince);
    };

    const onOnline = () => void check(0);

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('online', onOnline);
    };
  }, [check]);

  // Tier 2: no safe moment arrived, so ask.
  useEffect(() => {
    if (!updateAvailable || escalatedRef.current) return;

    const pendingSince = pendingSinceRef.current ?? Date.now();
    const remaining = Math.max(
      0,
      ESCALATE_AFTER_MS - (Date.now() - pendingSince),
    );

    const timer = setTimeout(() => {
      // Once only. This effect re-runs on every re-render of a component that
      // sits near the root, and re-firing would resurrect a toast the user had
      // already dismissed.
      escalatedRef.current = true;
      toast.info(t('title'), {
        id: TOAST_ID,
        description: t('description'),
        duration: Infinity,
        action: {
          label: t('reload'),
          onClick: () => window.location.reload(),
        },
      });
    }, remaining);

    return () => clearTimeout(timer);
  }, [updateAvailable, t]);

  // Tier 3: a chunk actually failed. Reload once, then let the error surface
  // rather than looping on a genuinely broken asset.
  useEffect(() => {
    const recover = (message: string | undefined) => {
      if (!message || !CHUNK_ERROR_PATTERN.test(message)) return;
      try {
        if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return;
        sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
      } catch {
        // Without storage we cannot guarantee one-shot; don't risk a loop.
        return;
      }
      window.location.reload();
    };

    const onError = (event: ErrorEvent) =>
      recover(event.message ?? event.error?.message);
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { message?: string } | string | undefined;
      recover(typeof reason === 'string' ? reason : reason?.message);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return (
    <ReloadBlockContext.Provider value={contextValue}>
      {children}
    </ReloadBlockContext.Provider>
  );
}
