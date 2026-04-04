'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { HelpDialog } from '@/components/app/HelpDialog';
import {
  ChevronLeft,
  CircleCheck,
  EyeOff,
  Pencil,
  Settings,
  Star,
} from 'lucide-react';
import { useLearningChatToggle } from './LearningChatLayout';

interface LearningHeaderProps {
  onBack: () => void;
  onSettingsOpen: () => void;
  onRestartTutorial?: () => void;
  onHelpOpen?: () => void;
  /** When `'full'`, the help dialog lists full-review-only shortcuts */
  reviewMode?: 'audio' | 'full';
  cardCounts?: { new: number; learning: number; review: number } | null;
}

export function LearningHeader({
  onBack,
  onSettingsOpen,
  onRestartTutorial,
  onHelpOpen,
  reviewMode = 'audio',
  cardCounts,
}: LearningHeaderProps) {
  const t = useTranslations('LearningMode');
  const tSettings = useTranslations('LearningMode.settingsPanel');
  const { isChatOpen, closeChat } = useLearningChatToggle();

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
        <Button variant="ghost" onClick={onBack} className="gap-2 -ml-2 z-10 hidden lg:inline-flex">
          <ChevronLeft className="h-4 w-4" />
          {t('back')}
        </Button>

        <div className="flex-1 min-w-0 flex items-center justify-center">
          {isChatOpen ? (
            <span className="heading-section lg:hidden">{t('chat')}</span>
          ) : cardCounts ? (
            <div className="flex items-center gap-1 leading-tight">
              <div className="flex flex-col items-center">
                <span className="text-sm font-semibold tabular-nums text-foreground">{cardCounts.new}</span>
                <span className="text-[10px] text-muted-foreground">{t('cardCounts.new')}</span>
              </div>
              <span className="text-sm text-muted-foreground self-start">–</span>
              <div className="flex flex-col items-center">
                <span className="text-sm font-semibold tabular-nums text-foreground">{cardCounts.learning}</span>
                <span className="text-[10px] text-muted-foreground">{t('cardCounts.learning')}</span>
              </div>
              <span className="text-sm text-muted-foreground self-start">–</span>
              <div className="flex flex-col items-center">
                <span className="text-sm font-semibold tabular-nums text-foreground">{cardCounts.review}</span>
                <span className="text-[10px] text-muted-foreground">{t('cardCounts.review')}</span>
              </div>
            </div>
          ) : null}
        </div>

        <div className={`ml-auto flex items-center gap-1 z-10 ${isChatOpen ? 'hidden lg:flex' : 'flex'}`}>
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
                <ul className="list-disc pl-4 space-y-1.5 text-xs text-muted-foreground">
                  <li>{tSettings('shortcutRating')}</li>
                  <li>{tSettings('shortcutPause')}</li>
                  <li>{tSettings('shortcutReveal')}</li>
                  {reviewMode === 'full' && (
                    <li>{tSettings('shortcutRevertSubmission')}</li>
                  )}
                </ul>
              </div>
            </div>
          </HelpDialog>
          <ThemeSwitcher className="-mr-1" />
          <Button
            variant="ghost"
            size="icon"
            onClick={onSettingsOpen}
            className="size-9 -mr-1"
            data-tutorial="settings-button"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}
