'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { ChevronLeft, CircleCheck, EyeOff, Info, Settings, Star } from 'lucide-react';
import { useLearningChatToggle } from './LearningChatLayout';

interface LearningHeaderProps {
  onBack: () => void;
  onSettingsOpen: () => void;
}

export function LearningHeader({
  onBack,
  onSettingsOpen,
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

        <h1 className="heading-section absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="lg:hidden">{isChatOpen ? t('chat') : t('title')}</span>
          <span className="hidden lg:inline">{t('title')}</span>
        </h1>

        <div className={`ml-auto flex items-center gap-1 z-10 ${isChatOpen ? 'hidden lg:flex' : 'flex'}`}>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-1"
                aria-label={tSettings('iconLegend')}
              >
                <Info className="h-5 w-5" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" side="bottom" className="w-64 p-3">
              <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider mb-2">
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
              </div>
            </PopoverContent>
          </Popover>
          <ThemeSwitcher className="-mr-1" />
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
