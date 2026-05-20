'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Sparkles } from 'lucide-react';
import { cefrForOgte } from '../steps/CefrSelfPickStep';

/**
 * Confirmation dialog shown when the user clicks "Pick this level" on the
 * CEFR self-pick step. Offers two paths:
 *   - Start at the chosen level immediately.
 *   - Take a quick adaptive test starting from the chosen level — biases
 *     the test's first question at the user's guess, then refines.
 */
interface Props {
  open: boolean;
  ogteLevel: number;
  onOpenChange: (open: boolean) => void;
  onStartHere: () => void;
  onTakeQuickTest: () => void;
}

export function CefrConfirmDialog({
  open,
  ogteLevel,
  onOpenChange,
  onStartHere,
  onTakeQuickTest,
}: Props) {
  const t = useTranslations('Onboarding.cefrConfirm');
  const cefr = cefrForOgte(ogteLevel);
  const levelStr = ogteLevel.toString().padStart(2, '0');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="cefr-confirm-dialog" className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('title', { level: levelStr })}</DialogTitle>
          <DialogDescription>
            {t.rich('description', {
              badge: () => (
                <Badge variant="outline" className="font-mono">
                  {levelStr} · {cefr}
                </Badge>
              ),
            })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:gap-2 flex-col sm:flex-col">
          <Button
            onClick={onStartHere}
            className="w-full"
            data-testid="cefr-confirm-start-here"
          >
            {t('startHere')}
          </Button>
          <Button
            onClick={onTakeQuickTest}
            variant="outline"
            className="w-full gap-2"
            data-testid="cefr-confirm-take-test"
          >
            <Sparkles className="h-4 w-4" />
            {t('takeQuickTest')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
