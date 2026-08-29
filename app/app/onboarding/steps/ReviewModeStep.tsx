'use client';

import { useTranslations } from 'next-intl';
import { Headphones, Languages, Ear } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Final wizard step: "How do you want to learn?". A flat three-card mode
 * selector (Shadowing preselected in spirit, but nothing is chosen until the
 * user taps). Translate and Transcribe are first-class options rather than
 * sub-choices behind a "Writing" card; both map to the 'full' review mode
 * with their writing style:
 *
 *   audio → { reviewMode: 'audio' }
 *   translate/transcribe → { reviewMode: 'full', writingInputMode: choice }
 *
 * The pick is persisted to `onboardingProgress` and copied onto the new
 * course's settings by `completeOnboarding`, which the shared Continue
 * button fires directly after this step (there is no separate
 * "customizing" screen anymore. Continue creates the course and drops the
 * user straight into their first real lesson).
 */

export type ReviewModeChoice = 'audio' | 'translate' | 'transcribe';

interface Props {
  selected: ReviewModeChoice | null;
  onSelect: (choice: ReviewModeChoice) => void;
}

export function ReviewModeStep({ selected, onSelect }: Props) {
  const t = useTranslations('Onboarding.reviewMode');
  return (
    <div
      data-testid="onboarding-step-review-mode"
      className="h-full overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="min-h-full flex flex-col justify-center py-6">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
        <div className="space-y-2 max-w-md mx-auto w-full text-left">
          <ModeRow
            testId="review-mode-audio"
            selected={selected === 'audio'}
            onClick={() => onSelect('audio')}
            Icon={Headphones}
            title={t('modes.audio.title')}
            description={t('modes.audio.description')}
            footnote={t('modes.audio.footnote')}
          />
          <ModeRow
            testId="review-mode-translate"
            selected={selected === 'translate'}
            onClick={() => onSelect('translate')}
            Icon={Languages}
            title={t('modes.translate.title')}
            description={t('modes.translate.description')}
          />
          <ModeRow
            testId="review-mode-transcribe"
            selected={selected === 'transcribe'}
            onClick={() => onSelect('transcribe')}
            Icon={Ear}
            title={t('modes.transcribe.title')}
            description={t('modes.transcribe.description')}
          />
        </div>
      </div>
    </div>
  );
}

function ModeRow({
  selected,
  onClick,
  Icon,
  title,
  description,
  footnote,
  testId,
}: {
  selected: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  footnote?: string;
  testId?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'w-full rounded-xl border p-3 md:p-4 text-left transition-all flex items-start gap-3',
        'hover:bg-accent',
        selected && 'border-primary bg-primary/5 ring-2 ring-primary/20',
      )}
    >
      <div
        className={cn(
          'shrink-0 h-9 w-9 rounded-lg flex items-center justify-center',
          selected ? 'bg-primary/15' : 'bg-muted',
        )}
      >
        <Icon
          className={cn(
            'h-4 w-4',
            selected ? 'text-primary' : 'text-muted-foreground',
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground mt-0.5">
          {description}
        </div>
        {footnote ? (
          <div className="text-[11px] text-muted-foreground italic mt-1">
            {footnote}
          </div>
        ) : null}
      </div>
    </button>
  );
}
