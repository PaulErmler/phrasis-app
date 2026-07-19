'use client';

import { useState, useLayoutEffect, useRef } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import {
  getLocalizedLanguageNameByCode,
  getTextDirection,
} from '@/lib/languages';
import { MAX_CARD_TEXT_LENGTH } from '@/lib/constants/learning';
import { useCourseLanguages } from '@/hooks/use-course-languages';
import { cn } from '@/lib/utils';

interface EditApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  approvalId: Id<'cardApprovals'>;
  translations: { language: string; text: string }[];
}

export function EditApprovalDialog({
  open,
  onOpenChange,
  approvalId,
  translations,
}: EditApprovalDialogProps) {
  const t = useTranslations('EditCardApproval');
  const locale = useLocale();
  const updateTranslations = useMutation(
    api.features.chat.cardApprovals.updateApprovalTranslations,
  );
  const { baseLanguages, targetLanguages } = useCourseLanguages();

  const [editedTexts, setEditedTexts] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const wasOpenRef = useRef(false);

  useLayoutEffect(() => {
    if (open && !wasOpenRef.current) {
      const initial: Record<string, string> = {};
      for (const tr of translations) {
        initial[tr.language] = tr.text;
      }
      setEditedTexts(initial);
    }
    wasOpenRef.current = open;
  }, [open, translations]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const translationArgs = translations.map((tr) => ({
        language: tr.language,
        text: editedTexts[tr.language] ?? tr.text,
      }));
      await updateTranslations({ approvalId, translations: translationArgs });
      onOpenChange(false);
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges = translations.some(
    (tr) =>
      Object.hasOwn(editedTexts, tr.language) &&
      editedTexts[tr.language] !== tr.text,
  );

  const hasOverLimit = Object.values(editedTexts).some(
    (text) => text.length > MAX_CARD_TEXT_LENGTH,
  );

  const hasEmpty = translations.some(
    (tr) => (editedTexts[tr.language] ?? tr.text).trim().length === 0,
  );

  const approvalLanguages = translations.map((tr) => tr.language);
  const orderedBase = baseLanguages.filter(
    (l) => approvalLanguages.includes(l) && !targetLanguages.includes(l),
  );
  const orderedTarget = targetLanguages.filter((l) =>
    approvalLanguages.includes(l),
  );
  const orderedKnown = [...orderedBase, ...orderedTarget];
  const orderedExtra = approvalLanguages.filter((l) => !orderedKnown.includes(l));
  const orderedLanguages = [...orderedKnown, ...orderedExtra];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="top-[calc(3.5rem+1.5rem)] max-h-[calc(100dvh-3.5rem-1.5rem-1rem-env(safe-area-inset-bottom,0px))] translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-sm"
      >
        <DialogHeader>
          <DialogTitle>{t('title')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 overflow-y-auto">
          {orderedLanguages.map((lang) => {
            const value = editedTexts[lang] ?? '';
            const isOverLimit = value.length > MAX_CARD_TEXT_LENGTH;
            return (
              <div key={lang} className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <Label htmlFor={`edit-approval-${lang}`}>
                    {getLocalizedLanguageNameByCode(lang, locale)}
                  </Label>
                  <span
                    className={`text-xs tabular-nums ${isOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
                  >
                    {isOverLimit
                      ? `+${value.length - MAX_CARD_TEXT_LENGTH}`
                      : `${value.length}/${MAX_CARD_TEXT_LENGTH}`}
                  </span>
                </div>
                <Textarea
                  id={`edit-approval-${lang}`}
                  value={value}
                  rows={2}
                  onChange={(e) =>
                    setEditedTexts((prev) => ({
                      ...prev,
                      [lang]: e.target.value,
                    }))
                  }
                  dir={getTextDirection(lang)}
                  className={cn(
                    'text-left',
                    isOverLimit &&
                      'border-destructive focus-visible:ring-destructive',
                  )}
                />
              </div>
            );
          })}
        </div>
        <DialogFooter className="flex !flex-row w-full gap-2 [&>*]:min-w-0">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={isSaving}
            onClick={() => onOpenChange(false)}
          >
            {t('cancel')}
          </Button>
          <Button
            type="button"
            className="flex-1"
            onClick={handleSave}
            disabled={isSaving || !hasChanges || hasOverLimit || hasEmpty}
          >
            {isSaving ? (
              <>
                <Loader2 className="h-4 w-4 shrink-0 animate-spin mr-2" />
                {t('saving')}
              </>
            ) : (
              t('save')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
