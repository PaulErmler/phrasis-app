'use client';

import {
  useState,
  useCallback,
  useRef,
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageCircle, ChevronRight } from 'lucide-react';

// -- Context to share chat toggle state with the header ----------------------

interface PendingPrompt {
  text: string;
  nonce: number;
}

interface LearningChatContextValue {
  isChatOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  pendingPrompt: PendingPrompt | null;
  openChatWithPrompt: (text: string) => void;
  /**
   * Returns true only for the first caller of a given nonce. Guards against
   * duplicate submissions when the chat panel is mounted in multiple slots
   * (desktop + mobile are both always in the React tree, CSS just hides one)
   * and against React Strict Mode's double-effect behavior in dev.
   */
  claimPrompt: (nonce: number) => boolean;
}

const LearningChatContext = createContext<LearningChatContextValue>({
  isChatOpen: false,
  openChat: () => {},
  closeChat: () => {},
  toggleChat: () => {},
  pendingPrompt: null,
  openChatWithPrompt: () => {},
  claimPrompt: () => false,
});

export function useLearningChatToggle() {
  return useContext(LearningChatContext);
}

// -- Layout component --------------------------------------------------------

interface LearningChatLayoutProps {
  header: ReactNode;
  children: ReactNode;
  chatPanel: ReactNode;
  onChatOpen?: () => void;
}

/**
 * Responsive layout for learning mode + chat:
 * - Header spans full width on top
 * - Desktop (lg+): learning content and chat sidebar side-by-side below header
 * - Mobile (<lg): chat replaces learning content when toggled (via header button)
 */
export function LearningChatLayout({
  header,
  children,
  chatPanel,
  onChatOpen,
}: LearningChatLayoutProps) {
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [pendingPrompt, setPendingPrompt] = useState<PendingPrompt | null>(null);
  const claimedNonceRef = useRef<number | null>(null);

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

  const claimPrompt = useCallback((nonce: number) => {
    if (claimedNonceRef.current === nonce) return false;
    claimedNonceRef.current = nonce;
    return true;
  }, []);

  return (
    <LearningChatContext.Provider
      value={{
        isChatOpen,
        openChat,
        closeChat,
        toggleChat,
        pendingPrompt,
        openChatWithPrompt,
        claimPrompt,
      }}
    >
      <div className="h-dvh max-h-dvh flex flex-col overflow-hidden">
        {header}

        <div className="relative flex-1 flex flex-col lg:flex-row min-h-0 w-full">
          {/* Desktop: learning body */}
          <div className="hidden lg:flex flex-1 min-w-0 min-h-0 justify-center overflow-hidden">
            <div className="w-full max-w-2xl flex flex-col min-h-0">
              {children}
            </div>
          </div>

          {/* Desktop: full height toggle bar — carries tutorial attr only when chat is closed */}
          <div
            className="hidden lg:flex flex-col justify-center items-center w-8 shrink-0 border-l bg-muted/10 hover:bg-muted/30 cursor-pointer transition-colors z-20"
            onClick={toggleChat}
            {...(!isChatOpen ? { 'data-tutorial': 'chat-button' } : {})}
          >
            {isChatOpen ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <MessageCircle className="h-4 w-4 text-muted-foreground" />}
          </div>

          {/* Desktop: collapsible chat sidebar — carries tutorial attr when open */}
          <AnimatePresence initial={false}>
            {isChatOpen && (
              <motion.div
                key="desktop-chat"
                className="hidden lg:flex shrink-0 min-w-0 min-h-0 bg-background relative z-10"
                initial={{ width: 0 }}
                animate={{ width: "calc(33vw - 1rem)" }}
                exit={{ width: 0 }}
                transition={{ type: "spring", stiffness: 350, damping: 35 }}
                data-tutorial="chat-button"
              >
                <div className="w-[calc(33vw-1rem)] min-w-[calc(33vw-1rem)] h-full overflow-hidden border-l">
                  {chatPanel}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Mobile: both panels always mounted, slide to toggle */}
          <div className="flex-1 lg:hidden min-w-0 min-h-0 relative overflow-clip">
            <motion.div
              className="absolute inset-0 flex flex-col"
              initial={false}
              animate={{ x: isChatOpen ? '-100%' : 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 35 }}
            >
              {children}
            </motion.div>
            <motion.div
              className="absolute inset-0 flex flex-col bg-background"
              initial={false}
              animate={{ x: isChatOpen ? 0 : '100%' }}
              transition={{ type: 'spring', stiffness: 350, damping: 35 }}
              {...(isChatOpen ? { 'data-tutorial': 'chat-button' } : {})}
            >
              {chatPanel}
            </motion.div>
          </div>
        </div>
      </div>
    </LearningChatContext.Provider>
  );
}
