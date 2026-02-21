'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Loader2, Settings } from 'lucide-react';
import { useLearningChatToggle } from './LearningChatLayout';

interface LearningHeaderProps {
  onBack: () => void;
  onSettingsOpen: () => void;
  isNavigating?: boolean;
}

export function LearningHeader({
  onBack,
  onSettingsOpen,
  isNavigating = false,
}: LearningHeaderProps) {
  const t = useTranslations('LearningMode');
  const { isChatOpen, closeChat } = useLearningChatToggle();

  const BackIcon = isNavigating ? Loader2 : ChevronLeft;
  const backIconClass = isNavigating ? 'h-4 w-4 animate-spin' : 'h-4 w-4';

  return (
    <header className="sticky-header">
      <div className="container mx-auto px-4 h-14 flex items-center relative">
        {/* Mobile: swap back action & title when chat is open */}
        <Button
          variant="ghost"
          onClick={isChatOpen ? closeChat : onBack}
          disabled={isNavigating}
          className="gap-2 -ml-2 z-10 lg:hidden"
        >
          <BackIcon className={backIconClass} />
          {t('back')}
        </Button>
        {/* Desktop: always show normal back */}
        <Button variant="ghost" onClick={onBack} disabled={isNavigating} className="gap-2 -ml-2 z-10 hidden lg:inline-flex">
          <BackIcon className={backIconClass} />
          {t('back')}
        </Button>

        <h1 className="heading-section absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="lg:hidden">{isChatOpen ? t('chat') : t('title')}</span>
          <span className="hidden lg:inline">{t('title')}</span>
        </h1>

        <div className={`ml-auto flex items-center gap-1 z-10 ${isChatOpen ? 'hidden lg:flex' : 'flex'}`}>
          <Button
            variant="ghost"
            size="icon"
            onClick={onSettingsOpen}
            className="-mr-2"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>
      </div>
    </header>
  );
}
