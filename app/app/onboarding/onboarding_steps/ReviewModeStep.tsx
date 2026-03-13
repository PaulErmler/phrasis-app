import { useTranslations } from 'next-intl';
import { BookOpen, Headphones } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ReviewMode } from '../types';

interface ReviewModeStepProps {
  selectedMode: ReviewMode | null;
  onSelectMode: (mode: ReviewMode) => void;
}

export function ReviewModeStep({
  selectedMode,
  onSelectMode,
}: ReviewModeStepProps) {
  const t = useTranslations('Onboarding.reviewMode');

  const modes = [
    {
      id: 'full' as const,
      icon: BookOpen,
      title: t('full.title'),
      description: t('full.description'),
    },
    {
      id: 'audio' as const,
      icon: Headphones,
      title: t('audio.title'),
      description: t('audio.description'),
    },
  ];

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center space-y-2 mb-6 py-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
      </div>

      <div className="flex-1 flex flex-col gap-3 overflow-y-auto py-3 pr-3">
        {modes.map((mode) => {
          const Icon = mode.icon;
          const isSelected = selectedMode === mode.id;

          return (
            <Button
              key={mode.id}
              variant="ghost"
              onClick={() => onSelectMode(mode.id)}
              className={cn(
                'w-full h-auto flex items-center justify-start gap-4 p-4 rounded-xl border-2 transition-all text-left whitespace-normal',
                isSelected
                  ? 'border-primary bg-primary/5 shadow-sm hover:bg-primary/5'
                  : 'border-muted hover:border-muted-foreground/30 hover:bg-muted/50',
              )}
            >
              <div className="p-2.5 rounded-lg shrink-0 text-primary">
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base leading-none mb-1">
                  {mode.title}
                </h3>
                <p className="text-muted-sm">{mode.description}</p>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
