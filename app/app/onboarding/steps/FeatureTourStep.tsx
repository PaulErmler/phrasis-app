'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ChevronLeft, ChevronRight, Pencil, FileUp, Radio, BarChart3, Globe } from 'lucide-react';

/**
 * 5-slide feature tour. Each slide highlights a feature the user will find
 * useful but won't discover unprompted: chat-driven flashcards, custom
 * cards, CSV import, radio mode, and the Pro-tier multi-language flow.
 */

const SLIDE_KEYS = ['custom', 'import', 'radio', 'stats', 'multilang'] as const;
const SLIDE_ICONS: Record<typeof SLIDE_KEYS[number], React.ComponentType<{ className?: string }>> = {
  custom: Pencil,
  import: FileUp,
  radio: Radio,
  stats: BarChart3,
  multilang: Globe,
};

interface Props {
  onComplete: () => void;
}

export function FeatureTourStep({ onComplete }: Props) {
  const t = useTranslations('Onboarding.featureTour');
  const [idx, setIdx] = useState(0);
  const slideKey = SLIDE_KEYS[idx];
  const isLast = idx === SLIDE_KEYS.length - 1;
  const Icon = SLIDE_ICONS[slideKey];

  return (
    <div
      data-testid="onboarding-step-feature-tour"
      data-tour-index={idx}
      className="h-full overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="min-h-full flex flex-col justify-center py-6">
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>
      {/* Fixed-height card with a grid layout so the icon + title sit at the
          same vertical position on every slide regardless of body length.
          Without this, longer body copy bumped the icon up and the box's
          inner content felt like it shifted between slides. */}
      <Card className="max-w-md mx-auto w-full">
        <CardContent className="p-8 text-center h-[18rem] grid grid-rows-[auto_auto_1fr] gap-3 items-start">
          <Icon className="h-12 w-12 mx-auto text-primary" />
          <h3 className="text-xl font-semibold">{t(`slides.${slideKey}.title`)}</h3>
          <p className="text-muted-foreground text-sm self-start">
            {t(`slides.${slideKey}.body`)}
          </p>
        </CardContent>
      </Card>

      <div className="max-w-md mx-auto w-full mt-6 flex items-center justify-between">
        {idx === 0 ? (
          // No back button on the first step — the wizard's Continue / Done
          // is the only way forward, and there's no "before" to go to.
          <div className="w-[88px]" />
        ) : (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setIdx(idx - 1)}
            data-testid="feature-tour-back"
          >
            <ChevronLeft className="h-4 w-4" /> {t('back')}
          </Button>
        )}
        <div className="flex items-center gap-1.5">
          {SLIDE_KEYS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? 'w-6 bg-primary' : 'w-1.5 bg-muted'
              }`}
            />
          ))}
        </div>
        {isLast ? (
          <Button size="sm" onClick={onComplete} data-testid="feature-tour-done">
            {t('done')}
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => setIdx(idx + 1)}
            data-testid="feature-tour-next"
          >
            {t('next')} <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </div>
      </div>
    </div>
  );
}
