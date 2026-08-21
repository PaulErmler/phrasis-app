'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { Sparkles, Layers } from 'lucide-react';

interface Props {
  selected: 'new' | 'self-pick' | 'test' | null;
  onSelect: (branch: 'new' | 'self-pick' | 'test') => void;
}

/**
 * Branch step: "How well do you know this language?"
 *
 * - "Completely new" → instant L01 (no test).
 * - "Self-pick" → CEFR ladder step.
 * - "Test me" → adaptive placement test step.
 */
export function ProficiencyBranchStep({ selected, onSelect }: Props) {
  const t = useTranslations('Onboarding.proficiency');
  return (
    <div
      data-testid="onboarding-step-proficiency"
      className="h-full overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="min-h-full flex flex-col justify-center py-6">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 max-w-3xl mx-auto w-full">
          <BranchCard
            testId="proficiency-branch-new"
            selected={selected === 'new'}
            onClick={() => onSelect('new')}
            Icon={Sparkles}
            title={t('branches.new.title')}
            description={t('branches.new.description')}
          />
          <BranchCard
            testId="proficiency-branch-self-pick"
            selected={selected === 'self-pick'}
            onClick={() => onSelect('self-pick')}
            Icon={Layers}
            title={t('branches.selfPick.title')}
            description={t('branches.selfPick.description')}
            recommendedLabel={t('recommended')}
          />
          <BranchCard
            testId="proficiency-branch-test"
            selected={selected === 'test'}
            onClick={() => onSelect('test')}
            Icon={QuickTestIcon}
            title={t('branches.test.title')}
            description={t('branches.test.description')}
          />
        </div>
      </div>
    </div>
  );
}

function BranchCard({
  selected,
  onClick,
  Icon,
  title,
  description,
  testId,
  recommendedLabel,
}: {
  selected: boolean;
  onClick: () => void;
  Icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  testId?: string;
  recommendedLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={cn(
        'relative rounded-xl border p-6 text-left transition-all flex flex-col gap-3',
        'hover:bg-accent hover:scale-[1.02]',
        selected && 'border-primary bg-primary/5 ring-2 ring-primary/20',
      )}
    >
      {recommendedLabel ? (
        <span
          data-testid="proficiency-branch-recommended"
          className="absolute top-3 right-3 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary"
        >
          {recommendedLabel}
        </span>
      ) : null}
      <Icon className={cn('h-7 w-7', selected ? 'text-primary' : 'text-muted-foreground')} />
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground mt-1">{description}</div>
      </div>
    </button>
  );
}

function QuickTestIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className={className}>
      <path d="M12 2v6m0 8v6m-10-10h6m8 0h6" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
