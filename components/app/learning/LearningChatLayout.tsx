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

export const LearningChatContext = createContext<LearningChatContextValue | null>(null);

export function useLearningChatToggle(): LearningChatContextValue | null {
  return useContext(LearningChatContext);
}

// -- Layout component --------------------------------------------------------

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
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
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
              data-coachmark-anchor="chat-button-desktop"
              {...(!effectiveChatOpen ? { 'data-tutorial': 'chat-button' } : {})}
            >
              {effectiveChatOpen ? (
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              ) : (
                <MessageCircle className="h-4 w-4 text-muted-foreground" />
              )}
            </div>
          )}

          {/* Chat. Fixed React tree position. Desktop: collapsible sidebar
              (width 0 ↔ open). Mobile: shown when open, fully hidden
              (display:none) when closed so the wrapper can't run any
              transform transition on viewport flip (the prior approach with
              `translate-x-full` would animate from no-transform to off-screen
              when going from desktop-closed to mobile-closed, briefly
              flashing the chat into view). Trade-off: no slide-in/out
              animation on mobile toggle. The chat snaps in/out. */}
          <div
            className={cn(
              'min-w-0 min-h-0 bg-background overflow-hidden',
              isDesktop
                ? cn(
                  'flex shrink-0 border-l relative z-10 transition-[width] duration-300 ease-out',
                  effectiveChatOpen ? 'w-[calc(33vw-1rem)]' : 'w-0',
                )
                : effectiveChatOpen
                  ? 'absolute inset-0 flex flex-col'
                  : 'hidden',
            )}
            {...(effectiveChatOpen ? { 'data-tutorial': 'chat-button' } : {})}
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
