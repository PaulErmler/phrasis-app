'use client';

import {
  useState,
  useCallback,
  createContext,
  useContext,
  type ReactNode,
} from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { MessageCircle, ChevronRight } from 'lucide-react';

// -- Context to share chat toggle state with the header ----------------------

interface LearningChatContextValue {
  isChatOpen: boolean;
  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
}

const LearningChatContext = createContext<LearningChatContextValue>({
  isChatOpen: false,
  openChat: () => {},
  closeChat: () => {},
  toggleChat: () => {},
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

  return (
    <LearningChatContext.Provider value={{ isChatOpen, openChat, closeChat, toggleChat }}>
      <div className="h-screen flex flex-col overflow-hidden">
        {header}

        <div className="relative flex-1 flex flex-col lg:flex-row min-h-0 w-full">
          {/* Desktop: learning body */}
          <div className="hidden lg:flex flex-1 min-w-0 min-h-0 justify-center overflow-hidden">
            <div className="w-full max-w-2xl flex flex-col min-h-0">
              {children}
            </div>
          </div>

          {/* Desktop: full height toggle bar */}
          <div 
            className="hidden lg:flex flex-col justify-center items-center w-8 shrink-0 border-l bg-muted/10 hover:bg-muted/30 cursor-pointer transition-colors z-20" 
            onClick={toggleChat}
          >
            {isChatOpen ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <MessageCircle className="h-4 w-4 text-muted-foreground" />}
          </div>

          {/* Desktop: collapsible chat sidebar */}
          <AnimatePresence initial={false}>
            {isChatOpen && (
              <motion.div
                key="desktop-chat"
                className="hidden lg:flex shrink-0 min-w-0 min-h-0 bg-background relative z-10"
                initial={{ width: 0 }}
                animate={{ width: "min(420px, 40vw)" }}
                exit={{ width: 0 }}
                transition={{ type: "spring", stiffness: 350, damping: 35 }}
              >
                <div className="w-[min(420px,40vw)] min-w-[min(420px,40vw)] h-full overflow-hidden border-l">
                  {chatPanel}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Mobile: both panels always mounted, slide to toggle */}
          <div className="flex-1 lg:hidden min-w-0 min-h-0 relative overflow-hidden">
            <motion.div
              className="absolute inset-0 flex flex-col"
              animate={{ x: isChatOpen ? '-100%' : 0 }}
              transition={{ type: 'spring', stiffness: 350, damping: 35 }}
            >
              {children}
            </motion.div>
            <motion.div
              className="absolute inset-0 flex flex-col bg-background"
              animate={{ x: isChatOpen ? 0 : '100%' }}
              transition={{ type: 'spring', stiffness: 350, damping: 35 }}
            >
              {chatPanel}
            </motion.div>
          </div>
        </div>
      </div>
    </LearningChatContext.Provider>
  );
}
