'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { KeyChips } from '@/components/app/learning/KeyChips';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { HelpDialog } from '@/components/app/HelpDialog';
import {
  BookOpen,
  ChevronLeft,
  CircleCheck,
  EyeOff,
  MessageSquarePlus,
  NotebookPen,
  Pencil,
  Radio,
  RefreshCw,
  Settings,
  Star,
} from 'lucide-react';
import { useLearningChatToggle } from './LearningChatLayout';
import { TUTORIAL_ANCHORS } from '@/lib/tutorials/anchors';
import type { SchedulingMode } from '@/convex/types';

interface LearningHeaderProps {
  onBack: () => void;
  /**
   * Starts a fresh conversation. Rendered as an icon at the right of the
   * mobile app bar while the chat is open (the desktop chat sidebar has its
   * own header with the same action).
   */
  onNewChat?: () => void;
  onSettingsOpen: () => void;
  onRestartTutorial?: () => void;
  onHelpOpen?: () => void;
  /** When `'full'`, the help dialog lists full-review-only shortcuts */
  reviewMode?: 'audio' | 'full';
  schedulingMode?: SchedulingMode;
  /**
   * Number of rating keys valid for the CURRENT card, so the legend tracks
   * the scheduling phase: a card's first reviews offer 2 ratings (1–2), FSRS
   * reviews 4 (1–4), radio none. See `getValidRatings` in lib/scheduling.
   */
  ratingCount?: number;
}

export function LearningHeader({
  onBack,
  onNewChat,
  onSettingsOpen,
  onRestartTutorial,
  onHelpOpen,
  reviewMode = 'audio',
  schedulingMode = 'learnAndReview',
  ratingCount = 4,
}: LearningHeaderProps) {
  const t = useTranslations('LearningMode');
  const tApp = useTranslations('AppPage');
  const tSettings = useTranslations('LearningMode.settingsPanel');
  const tChat = useTranslations('Chat.sidebar');
  const chatContext = useLearningChatToggle();
  if (!chatContext) {
    throw new Error(
      'LearningHeader must be rendered inside LearningChatLayout',
    );
  }
  const { isChatOpen, closeChat } = chatContext;
  // Free play is one scheduling mode wearing two names: "Radio" while
  // listening, "Free Study" while typing. The pill follows the review mode so
  // it renames itself the moment the user flips the switcher.
  const isFreePlay = schedulingMode === 'radio';
  const isListening = reviewMode === 'audio';

  return (
    <header className="sticky-header">
      <div className="container mx-auto px-4 h-14 flex items-center relative">
        {/* Mobile: swap back action & title when chat is open */}
        <Button
          variant="ghost"
          onClick={isChatOpen ? closeChat : onBack}
          className="gap-2 -ml-2 z-10 lg:hidden"
        >
          <ChevronLeft className="h-4 w-4" />
          {t('back')}
        </Button>
        {/* Desktop: always show normal back */}
        <Button
          variant="ghost"
          onClick={onBack}
          className="gap-2 -ml-2 z-10 hidden lg:inline-flex"
        >
          <ChevronLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex-1 min-w-0 flex items-center justify-center">
          {isChatOpen ? (
            // Absolutely centered in the bar: the back button and the
            // new-chat icon differ in width, so centering within the
            // leftover flex space would sit the title off-center.
            <span className="heading-section lg:hidden absolute left-1/2 -translate-x-1/2 whitespace-nowrap">
              {t('chat')}
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium text-muted-foreground"
              data-testid="learn-mode-pill"
            >
              {isFreePlay ? (
                isListening ? (
                  <Radio className="h-3.5 w-3.5" />
                ) : (
                  <NotebookPen className="h-3.5 w-3.5" />
                )
              ) : schedulingMode === 'learn_new' ? (
                <BookOpen className="h-3.5 w-3.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {tApp(
                isFreePlay
                  ? isListening
                    ? 'radioMode'
                    : 'freeStudyMode'
                  : schedulingMode === 'learn_new'
                    ? 'learnNew'
                    : 'learnAndReview',
              )}
            </span>
          )}
        </div>

        {/* Mobile, chat open: new-chat icon on the title's line, right. */}
        {isChatOpen && onNewChat && (
          <Button
            variant="ghost"
            size="icon"
            onClick={onNewChat}
            className="ml-auto h-9 w-9 -mr-1 z-10 lg:hidden"
            aria-label={tChat('newChat')}
            data-testid="learn-chat-new-mobile"
          >
            <MessageSquarePlus className="h-5 w-5" />
          </Button>
        )}

        <div
          className={`ml-auto flex items-center gap-1 z-10 ${isChatOpen ? 'hidden lg:flex' : 'flex'}`}
        >
          <HelpDialog
            onRestartTutorial={onRestartTutorial}
            onOpen={onHelpOpen}
            triggerClassName="-mr-1"
          >
            <div className="space-y-4">
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  {tSettings('iconLegend')}
                </p>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <Star className="h-3.5 w-3.5 text-favorite shrink-0" />
                    <span>{tSettings('iconFavorite')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <CircleCheck className="h-3.5 w-3.5 text-success shrink-0" />
                    <span>{tSettings('iconMaster')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <EyeOff className="h-3.5 w-3.5 text-destructive shrink-0" />
                    <span>{tSettings('iconHide')}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <Pencil className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span>{tSettings('iconEdit')}</span>
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                  {tSettings('shortcuts')}
                </p>
                <div className="flex flex-col gap-1.5">
                  <ShortcutRow
                    label={tSettings('shortcutRevealNext')}
                    keys={['Enter', '→']}
                    join="/"
                  />
                  <ShortcutRow
                    label={tSettings('shortcutPlayPause')}
                    keys={['Space']}
                  />
                  <ShortcutRow
                    label={tSettings(
                      reviewMode === 'full'
                        ? 'shortcutPreviousWriting'
                        : 'shortcutPrevious',
                    )}
                    keys={['←']}
                  />
                  <ShortcutRow
                    label={tSettings('shortcutRestartAudio')}
                    keys={['R']}
                  />
                  <ShortcutRow
                    label={tSettings('shortcutReplayTarget')}
                    keys={['T']}
                  />
                  <ShortcutRow
                    label={tSettings('shortcutRestartCard')}
                    keys={['Shift', 'R']}
                    join="+"
                  />
                  {ratingCount > 0 && (
                    <ShortcutRow
                      label={tSettings('shortcutRate')}
                      keys={
                        ratingCount > 1 ? ['1', String(ratingCount)] : ['1']
                      }
                      join="–"
                    />
                  )}
                </div>
              </div>
            </div>
          </HelpDialog>
          <ThemeSwitcher className="-mr-1" />
          <Button
            variant="ghost"
            size="icon"
            onClick={onSettingsOpen}
            className="h-9 w-9 -mr-1"
            data-tutorial={TUTORIAL_ANCHORS.settingsButton}
            data-testid="learn-settings"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}

/**
 * One row of the shortcuts legend: action label left, key chips right.
 * `join` disambiguates multi-chip rows: "+" for chords (Shift+R), "/" for
 * alternatives (Enter / →), "–" for ranges (1–4). Omitted = single chip.
 */
function ShortcutRow({
  label,
  keys,
  join,
}: {
  label: string;
  keys: string[];
  join?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs text-muted-foreground">
      <span>{label}</span>
      <KeyChips keys={keys} join={join} className="shrink-0" />
    </div>
  );
}
