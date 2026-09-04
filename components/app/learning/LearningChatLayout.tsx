'use client';

import {
  useState,
  useEffect,
  useCallback,
  useRef,
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import { MessageCircle, ChevronRight } from 'lucide-react';
import { useMediaQuery } from '@/hooks/use-media-query';
import { cn } from '@/lib/utils';
import { COACHMARK_ANCHORS, TUTORIAL_ANCHORS } from '@/lib/tutorials/anchors';
import type { QuickAction } from '@/convex/features/chat/quickActions';

// -- Context to share chat toggle state with the header ----------------------

interface PendingPrompt {
  text: string;
  /** When set, the send goes out as this quick action; `text` is only the visible bubble label. */
  quickAction?: QuickAction;
  nonce: number;
}

interface LearningChatContextValue {
  isChatOpen: boolean;
  /**
   * The open chat covers the card (narrow layout). On desktop the chat sits
   * beside the card, and the session shortcuts stay live for keys pressed on
   * the card side; the panel itself is marked `data-learning-chat-panel` so
   * keys pressed inside it are left to the chat.
   */
  chatCoversCard: boolean;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  pendingPrompt: PendingPrompt | null;
  openChatWithPrompt: (text: string) => void;
  openChatWithAction: (action: QuickAction, displayText: string) => void;
  /**
   * Returns true only for the first caller of a given nonce. Defends against
   * React Strict Mode's double-effect behaviour in dev so a prompt is only
   * submitted once even if `WrappedChatPanel`'s effect fires twice.
   */
  claimPrompt: (nonce: number) => boolean;
}

export const LearningChatContext =
  createContext<LearningChatContextValue | null>(null);

export function useLearningChatToggle(): LearningChatContextValue | null {
  return useContext(LearningChatContext);
}

// -- Layout component --------------------------------------------------------

/** Duration of the mobile chat slide, matching the card's `duration-300`. */
const MOBILE_CHAT_SLIDE_MS = 300;
/** `history.state` tag on the entry pushed for the open mobile chat. */
const CHAT_HISTORY_KEY = 'learnChatOpen';

interface LearningChatLayoutProps {
  header: ReactNode;
  children: ReactNode;
  chatPanel: ReactNode;
  onChatOpen?: () => void;
  /**
   * When true, suppresses the desktop chat toggle bar and force-closes any
   * open chat panel. Used during the celebration screen so chat affordances
   * stay out of that flow. The mobile chat button lives inside `LearningMode`
   * and is already hidden by the celebration early-return there.
   */
  hideChatToggle?: boolean;
}

/**
 * Responsive layout for learning mode + chat.
 *
 * `{children}` and `{chatPanel}` are each rendered exactly once at a fixed
 * React tree position; the viewport flip only swaps Tailwind classes on
 * their wrapper divs. The DOM never moves on resize, so `LearningMode`,
 * `ProgressDisplay`, and any in-flight audio/timers stay alive across the
 * `isDesktop` boundary. A mid-celebration window resize no longer restarts
 * the success sound or the counter animations.
 *
 * The chat slide (mobile) and width animation (desktop) use CSS transitions
 * instead of `motion.react` springs. Two motion.divs at different tree
 * positions would re-introduce the original dual-mount bug; keeping a
 * single wrapper and animating it via `transition-transform` /
 * `transition-[width]` is the trade-off that preserves the dedup invariant.
 */
export function LearningChatLayout({
  header,
  children,
  chatPanel,
  onChatOpen,
  hideChatToggle = false,
}: LearningChatLayoutProps) {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(
    null,
  );
  const claimedNonceRef = useRef<number | null>(null);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  // Match previous `NoChatContext` behaviour: celebration closes chat, and
  // it stays closed after the cele dismisses.
  useEffect(() => {
    if (hideChatToggle) setIsChatOpen(false);
  }, [hideChatToggle]);
  // Defensive. Covers the single frame between `hideChatToggle` flipping
  // true and the effect's `setIsChatOpen(false)` landing.
  const effectiveChatOpen = isChatOpen && !hideChatToggle;

  // ----- Mobile slide -----
  // The chat panel pushes in from the right while the card slides out to the
  // left, and the reverse on close, both over the same 300 ms ease-out. The
  // slide is a CSS keyframe animation (tw-animate-css `animate-in` /
  // `animate-out`), not a transform transition: a keyframe animation starts
  // the moment the panel leaves `display:none`, whereas a transition needs
  // the off-screen transform painted in a frame of its own first, and React
  // could commit the "slid in" transform before that paint happened, so the
  // panel snapped into place instead of sliding. `mobileChatMounted` keeps
  // the panel displayed for the slide-out, then restores `display:none`.
  // Resting at `display:none` (not `translate-x-full`) is what stops a
  // desktop→mobile viewport flip from animating the closed panel across the
  // screen (see the panel comment below).
  const [mobileChatMounted, setMobileChatMounted] = useState(false);
  useEffect(() => {
    if (isDesktop) {
      setMobileChatMounted(false);
      return;
    }
    if (effectiveChatOpen) {
      setMobileChatMounted(true);
      return;
    }
    const timer = setTimeout(
      () => setMobileChatMounted(false),
      MOBILE_CHAT_SLIDE_MS,
    );
    return () => clearTimeout(timer);
  }, [effectiveChatOpen, isDesktop]);

  // ----- Mobile history entry -----
  // On a phone the open chat covers the card like a pushed page, so it gets
  // a history entry of its own: an edge-swipe / hardware back then closes
  // the chat instead of leaving the learn session (the (main) layout's
  // popstate handler keeps /app/learn open because the URL is unchanged).
  // The entry is tagged in `history.state` so this component can tell "the
  // chat entry was popped" from any other popstate. A programmatic close
  // (header back button, celebration) pops the entry itself so the stack
  // doesn't keep a dead entry that would make the next swipe-back a no-op.
  const chatHistoryPushedRef = useRef(false);
  const isChatOpenRef = useRef(false);
  isChatOpenRef.current = effectiveChatOpen;
  useEffect(() => {
    // A stale tag on the entry this view mounts into (the chat's own entry,
    // reached again through back/forward after the view unmounted on top
    // of it) would make the popstate handler read a later swipe-back as
    // "still the chat's entry" and leave the chat open. Untag it first.
    if (typeof window === 'undefined') return;
    const state = window.history.state;
    if (state?.[CHAT_HISTORY_KEY]) {
      const { [CHAT_HISTORY_KEY]: _tag, ...rest } = state;
      window.history.replaceState(rest, '', window.location.href);
    }
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (effectiveChatOpen && !isDesktop) {
      if (chatHistoryPushedRef.current) return;
      chatHistoryPushedRef.current = true;
      window.history.pushState(
        { ...(window.history.state ?? {}), [CHAT_HISTORY_KEY]: true },
        '',
        window.location.href,
      );
      return;
    }
    if (!effectiveChatOpen && chatHistoryPushedRef.current) {
      chatHistoryPushedRef.current = false;
      if (window.history.state?.[CHAT_HISTORY_KEY]) {
        window.history.back();
      }
    }
  }, [effectiveChatOpen, isDesktop]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPopState = () => {
      if (window.history.state?.[CHAT_HISTORY_KEY]) return;
      if (!chatHistoryPushedRef.current) return;
      // The chat's entry was popped (swipe-back / back button). Clear the
      // flag BEFORE the state update so the close effect above doesn't pop
      // a second entry.
      chatHistoryPushedRef.current = false;
      if (isChatOpenRef.current) setIsChatOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    // Unmounting with the chat open (session end, the celebration screen)
    // would leave the chat's entry on top of the stack, so the next back
    // press lands on a dead entry. Pop it while it is still the current
    // entry. Once the app has pushed another page on top the entry is out
    // of reach; the mount effect above untags it when it is reached again.
    return () => {
      if (!chatHistoryPushedRef.current) return;
      chatHistoryPushedRef.current = false;
      if (window.history.state?.[CHAT_HISTORY_KEY]) window.history.back();
    };
  }, []);

  const openChat = useCallback(() => {
    setIsChatOpen(true);
    onChatOpen?.();
  }, [onChatOpen]);

  const closeChat = useCallback(() => {
    setIsChatOpen(false);
  }, []);

  const toggleChat = useCallback(() => {
    setIsChatOpen((prev) => !prev);
  }, []);

  const openChatWithPrompt = useCallback(
    (text: string) => {
      setPendingPrompt((prev) => ({ text, nonce: (prev?.nonce ?? 0) + 1 }));
      setIsChatOpen(true);
      onChatOpen?.();
    },
    [onChatOpen],
  );

  const openChatWithAction = useCallback(
    (action: QuickAction, displayText: string) => {
      setPendingPrompt((prev) => ({
        text: displayText,
        quickAction: action,
        nonce: (prev?.nonce ?? 0) + 1,
      }));
      setIsChatOpen(true);
      onChatOpen?.();
    },
    [onChatOpen],
  );

  const claimPrompt = useCallback((nonce: number) => {
    if (claimedNonceRef.current === nonce) return false;
    claimedNonceRef.current = nonce;
    return true;
  }, []);

  return (
    <LearningChatContext.Provider
      value={{
        isChatOpen: effectiveChatOpen,
        chatCoversCard: effectiveChatOpen && !isDesktop,
        openChat,
        closeChat,
        toggleChat,
        pendingPrompt,
        openChatWithPrompt,
        openChatWithAction,
        claimPrompt,
      }}
    >
      <div className="h-dvh max-h-dvh flex flex-col overflow-hidden">
        {header}

        <div
          className={cn(
            'relative flex-1 min-h-0 w-full',
            isDesktop ? 'flex flex-row' : 'overflow-clip',
          )}
        >
          {/* Body. Fixed React tree position. Desktop: flex item. Mobile:
              absolute-positioned overlay that slides left when chat opens. */}
          <div
            className={cn(
              'min-w-0 min-h-0',
              isDesktop
                ? 'flex flex-1 justify-center overflow-hidden'
                : cn(
                    'absolute inset-0 flex flex-col transition-transform duration-300 ease-out',
                    effectiveChatOpen ? '-translate-x-full' : 'translate-x-0',
                  ),
            )}
          >
            <div
              className={cn(
                'min-w-0 min-h-0 flex flex-col',
                isDesktop ? 'w-full max-w-2xl' : 'flex-1',
              )}
            >
              {children}
            </div>
          </div>

          {/* Toggle bar. Desktop only, suppressed during the celebration. */}
          {isDesktop && !hideChatToggle && (
            <div
              className="flex flex-col justify-center items-center w-8 shrink-0 border-l bg-muted/10 hover:bg-muted/30 cursor-pointer transition-colors z-20"
              onClick={toggleChat}
              data-coachmark-anchor={COACHMARK_ANCHORS.chatButtonDesktop}
              {...(!effectiveChatOpen
                ? { 'data-tutorial': TUTORIAL_ANCHORS.chatButton }
                : {})}
            >
              {effectiveChatOpen ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              ) : (
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          )}

          {/* Chat. Fixed React tree position. Desktop: collapsible sidebar
              (width 0 ↔ open). Mobile: slides in from the right over the
              card and back out on close. At rest while closed it is fully
              hidden (display:none), never parked at `translate-x-full`: a
              resting transform would animate from no-transform to
              off-screen on a desktop-closed → mobile-closed viewport flip,
              briefly flashing the chat into view. */}
          <div
            data-learning-chat-panel=""
            className={cn(
              'min-w-0 min-h-0 bg-background overflow-hidden',
              isDesktop
                ? cn(
                    'flex shrink-0 border-l relative z-10 transition-[width] duration-300 ease-out',
                    effectiveChatOpen ? 'w-[calc(33vw-1rem)]' : 'w-0',
                  )
                : mobileChatMounted
                  ? cn(
                      'absolute inset-0 flex flex-col duration-300 ease-out fill-mode-forwards will-change-transform',
                      effectiveChatOpen
                        ? 'animate-in slide-in-from-right'
                        : 'animate-out slide-out-to-right',
                    )
                  : 'hidden',
            )}
            {...(effectiveChatOpen
              ? { 'data-tutorial': TUTORIAL_ANCHORS.chatButton }
              : {})}
          >
            <div
              className={cn(
                'flex flex-col min-w-0 min-h-0 h-full',
                isDesktop
                  ? 'w-[calc(33vw-1rem)] min-w-[calc(33vw-1rem)] overflow-hidden'
                  : 'flex-1',
              )}
            >
              {chatPanel}
            </div>
          </div>
        </div>
      </div>
    </LearningChatContext.Provider>
  );
}
