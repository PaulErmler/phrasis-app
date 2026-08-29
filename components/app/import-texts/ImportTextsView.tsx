'use client';

import { type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import PaywallDialog from '@/components/autumn/paywall-dialog';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import { useImportController } from './useImportController';
import { StepperImportView } from './StepperImportView';

interface ImportTextsViewProps {
  onBack: () => void;
  headerSlot?: ReactNode;
}

export function ImportTextsView({ onBack, headerSlot }: ImportTextsViewProps) {
  const tEnter = useTranslations('EnterTexts');
  const c = useImportController();

  return (
    <>
      <div className="flex flex-col h-full">
        <header className="sticky-header">
          <div className="container mx-auto px-4 h-14 flex items-center">
            <Button
              variant="ghost"
              className="gap-2 -ml-2 min-w-0 shrink overflow-hidden"
              onClick={onBack}
            >
              <ChevronLeft className="h-4 w-4 shrink-0" />
              <span className="truncate">{tEnter('title')}</span>
            </Button>
          </div>
        </header>

        <div
          className="flex-1 overflow-y-auto px-4 py-4"
          style={{ scrollbarGutter: 'stable' }}
        >
          <div className="app-view space-y-4">
            {headerSlot}
            <StepperImportView c={c} />
          </div>
        </div>
      </div>

      {c.paywallOpen && (
        <PaywallDialog
          open={c.paywallOpen}
          setOpen={c.setPaywallOpen}
          featureId={FEATURE_IDS.CUSTOM_SENTENCES}
        />
      )}
    </>
  );
}
