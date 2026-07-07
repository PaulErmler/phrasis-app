'use client';

import {
  Component,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { getUserTimezone } from '@/lib/timezone';
import { markInAppNavigation } from '@/hooks/use-in-app-back';

/**
 * App-level warm state. Lives in app/app/layout.tsx — ABOVE the (main)
 * route group — so it survives navigation to sibling segments like
 * /app/learn and /app/onboarding. This is what lets the learn page inherit
 * the pre-warmed getCardForReview subscription and the prefetched chat
 * thread even though the (main) layout unmounts.
 */

interface ChatPrefetch {
  /** Last prefetched (still empty) thread id, or null before the first
   *  prefetch resolves / after a failure. */
  prefetchedThreadId: string | null;
  /** Returns the prefetched thread id (may be null) and re-fires the
   *  prefetch. getOrCreateEmptyThread returns the same thread while it is
   *  still empty, so consuming without using the thread is harmless. */
  consumeThread: () => string | null;
  /** Re-fire the prefetch, e.g. after a surface that may have used the
   *  thread (learn's embedded chat) unmounts. */
  refreshPrefetchedThread: () => void;
}

const ChatPrefetchContext = createContext<ChatPrefetch | null>(null);

export function useChatPrefetch(): ChatPrefetch {
  const ctx = useContext(ChatPrefetchContext);
  if (!ctx) throw new Error('useChatPrefetch must be used within AppWarmup');
  return ctx;
}

/**
 * Navigate to chat, preferring the prefetched empty thread (instant) and
 * falling back to creating one. Shared by Home and the learn page.
 */
export function useNavigateToChat(): () => void {
  const router = useRouter();
  const { consumeThread } = useChatPrefetch();
  const getOrCreateEmptyThread = useMutation(
    api.features.chat.threads.getOrCreateEmptyThread,
  );

  return useCallback(() => {
    const prefetched = consumeThread();
    if (prefetched) {
      router.push(`/app/chat/${prefetched}`);
      return;
    }
    getOrCreateEmptyThread({})
      .then((threadId) => router.push(`/app/chat/${threadId}`))
      .catch((err) => console.error('Failed to open chat:', err));
  }, [consumeThread, getOrCreateEmptyThread, router]);
}

/**
 * Warm Convex subscriptions, kept in a child component behind an error
 * boundary: Convex useQuery throws query errors into render, and a failed
 * warm-up must never take the app shell down — it is purely an optimization.
 */
function WarmQueries({ pathname }: { pathname: string }) {
  // Learn manages its own getCardForReview subscription (useLearningMode);
  // onboarding/admin never consumed the warm queries in the old shell.
  const skipWarm =
    pathname.startsWith('/app/learn') ||
    pathname.startsWith('/app/onboarding') ||
    pathname.startsWith('/app/admin');

  // Warm the getCardForReview subscription before learn opens. Args must
  // match useLearningMode's (timezone) so we hit the same subscription
  // cache entry and the warm survives the handoff.
  useQuery(
    api.features.scheduling.getCardForReview,
    skipWarm ? 'skip' : { timezone: getUserTimezone() },
  );

  // Keep the home summary live while the user is on other tabs so returning
  // to home renders fresh data instantly (parity with the old always-mounted
  // HomeView subscription).
  useQuery(api.features.home.getHomeSummary, skipWarm ? 'skip' : {});

  return null;
}

class SilentBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    console.error('App warm-up query failed:', error);
  }

  render() {
    return this.state.hasError ? null : this.props.children;
  }
}

export function AppWarmup({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isOnboarding = pathname.startsWith('/app/onboarding');

  // Count in-app navigations so useInAppBack knows when history.back() is
  // safe (i.e. the previous entry is one of ours, not another site).
  const prevPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevPathRef.current !== null && prevPathRef.current !== pathname) {
      markInAppNavigation();
    }
    prevPathRef.current = pathname;
  }, [pathname]);

  // Pre-create a chat thread so chat entry points can navigate instantly.
  const getOrCreateEmptyThread = useMutation(
    api.features.chat.threads.getOrCreateEmptyThread,
  );
  const [prefetchedThreadId, setPrefetchedThreadId] = useState<string | null>(
    null,
  );
  const refreshPrefetchedThread = useCallback(() => {
    // Best-effort: on failure the consumers fall back to creating a thread
    // themselves, where errors surface properly.
    getOrCreateEmptyThread({}).then(setPrefetchedThreadId).catch(() => {});
  }, [getOrCreateEmptyThread]);

  const didPrefetchThread = useRef(false);
  useEffect(() => {
    if (didPrefetchThread.current || isOnboarding) return;
    didPrefetchThread.current = true;
    refreshPrefetchedThread();
  }, [isOnboarding, refreshPrefetchedThread]);

  const consumeThread = useCallback(() => {
    const id = prefetchedThreadId;
    refreshPrefetchedThread();
    return id;
  }, [prefetchedThreadId, refreshPrefetchedThread]);

  // Reconcile local quota state with the billing provider once per app load
  // (moved verbatim from the old (main) layout; deferred past onboarding).
  const syncQuotas = useAction(api.usage.actions.syncQuotas);
  const didSyncQuotas = useRef(false);
  useEffect(() => {
    if (didSyncQuotas.current || isOnboarding) return;
    didSyncQuotas.current = true;
    syncQuotas().catch((err) => {
      console.error('Failed to sync quotas on app load:', err);
    });
  }, [isOnboarding, syncQuotas]);

  const chatPrefetch = useMemo<ChatPrefetch>(
    () => ({ prefetchedThreadId, consumeThread, refreshPrefetchedThread }),
    [prefetchedThreadId, consumeThread, refreshPrefetchedThread],
  );

  return (
    <ChatPrefetchContext.Provider value={chatPrefetch}>
      <SilentBoundary>
        <WarmQueries pathname={pathname} />
      </SilentBoundary>
      {children}
    </ChatPrefetchContext.Provider>
  );
}
