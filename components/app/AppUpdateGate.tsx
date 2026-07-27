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
 *      nothing is in flight — indistinguishable from a slow tab wake.
 *   2. A dismissible toast with a Reload button, but only once an update has
 *      been pending for a while with no safe moment to take it.
 *   3. A one-shot guarded reload if a chunk actually fails to load.
 *
 * Detection is focus-driven, not polled — mirroring BillingGate ("Focus-driven
 * rather than an interval: no polling, no cron"). `visibilitychange` also fires
 * on desktop tab switches, so the only uncovered case is a tab that stays
 * foregrounded forever.
 */

/**
 * Dev-only overrides for the two timing constants, so the silent-reload and
 * escalation paths can be exercised without waiting minutes or an hour:
 *
 *   NEXT_PUBLIC_UPDATE_HIDDEN_MS=3000 NEXT_PUBLIC_UPDATE_ESCALATE_MS=5000 pnpm dev
 *
 * `NODE_ENV` is statically replaced at build time, so production always uses
 * the real values regardless of what is set in the environment.
 */
function devMs(raw: string | undefined, fallback: number): number {
  if (process.env.NODE_ENV === 'production' || !raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/** How long the tab must have been hidden before a silent reload is harmless. */
const HIDDEN_LONG_ENOUGH_MS = devMs(
  process.env.NEXT_PUBLIC_UPDATE_HIDDEN_MS,
  10 * 60 * 1000,
);

/** How long an update may stay pending before we surface the toast. */
const ESCALATE_AFTER_MS = devMs(
  process.env.NEXT_PUBLIC_UPDATE_ESCALATE_MS,
  60 * 60 * 1000,
);

/**
 * If we reloaded toward a build and came back still running the old one,
 * something upstream is serving a stale document. Stop auto-reloading rather
 * than loop, and let the toast take over.
 */
const RELOAD_COOLDOWN_MS = 5 * 60 * 1000;

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
 * Holds off the silent reload while something un-resumable is in flight — a
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

function readReloadAttempt(): { toBuildId: string; at: number } | null {
  try {
    const raw = sessionStorage.getItem(RELOAD_ATTEMPT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { toBuildId?: unknown; at?: unknown };
    if (typeof parsed.toBuildId !== 'string' || typeof parsed.at !== 'number') {
      return null;
    }
    return { toBuildId: parsed.toBuildId, at: parsed.at };
  } catch {
    // Private mode, disabled storage, or corrupt value — treat as no attempt.
    return null;
  }
}

function writeReloadAttempt(toBuildId: string) {
  try {
    sessionStorage.setItem(
      RELOAD_ATTEMPT_KEY,
      JSON.stringify({ toBuildId, at: Date.now() }),
    );
  } catch {
    // Storage unavailable. The reload still happens; we just lose the loop
    // guard, which is the safer direction to fail in than not reloading.
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
        // Offline, or the endpoint is unreachable. Fail open — a network error
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
      const attempt = readReloadAttempt();
      if (
        attempt &&
        attempt.toBuildId === buildId &&
        Date.now() - attempt.at < RELOAD_COOLDOWN_MS
      ) {
        return;
      }

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
    if (!updateAvailable) return;

    const pendingSince = pendingSinceRef.current ?? Date.now();
    const remaining = Math.max(0, ESCALATE_AFTER_MS - (Date.now() - pendingSince));

    const timer = setTimeout(() => {
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
