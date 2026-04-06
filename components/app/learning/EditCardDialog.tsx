'use client';

import { useState, useLayoutEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import { getUserTimezone } from '@/lib/timezone';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { getLocalizedLanguageNameByCode } from '@/lib/languages';
import { ConvexError } from 'convex/values';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import UsageLimitDialog from '@/components/autumn/usage-limit-dialog';
import { MAX_CARD_TEXT_LENGTH } from '@/lib/constants/learning';
import type { CardTranslation } from './types';

interface EditCardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cardId: Id<'cards'>;
  translations: CardTranslation[];
}

export function EditCardDialog({
  open,
  onOpenChange,
  cardId,
  translations,
}: EditCardDialogProps) {
  const t = useTranslations('EditCard');
  const locale = useLocale();
  const editCard = useMutation(api.features.scheduling.editCard);

  const [editedTexts, setEditedTexts] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);

  useLayoutEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};
      for (const tr of translations) {
        initial[tr.language] = tr.text;
      }
      setEditedTexts(initial);
    }
  }, [open, translations]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      const translationArgs = Object.entries(editedTexts).map(
        ([language, text]) => ({ language, text }),
      );
      await editCard({ cardId, translations: translationArgs, timezone: getUserTimezone() });
      onOpenChange(false);
    } catch (err) {
      if (
        err instanceof ConvexError &&
        typeof err.data === 'object' &&
        err.data !== null &&
        'code' in err.data &&
        err.data.code === 'USAGE_LIMIT'
      ) {
        setLimitDialogOpen(true);
      } else {
        throw err;
      }
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

  const allLanguages = translations.map((tr) => tr.language);
  const baseLanguages = allLanguages.filter(
    (lang) => translations.find((tr) => tr.language === lang)?.isBaseLanguage,
  );
  const targetLanguages = allLanguages.filter(
    (lang) => translations.find((tr) => tr.language === lang)?.isTargetLanguage,
  );
  const orderedLanguages = [
    ...baseLanguages.filter((l) => !targetLanguages.includes(l)),
    ...targetLanguages,
  ];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          aria-describedby={undefined}
          className="top-[calc(3.5rem+1.5rem)] max-h-[calc(100dvh-3.5rem-1.5rem-1rem-env(safe-area-inset-bottom,0px))] translate-y-0 overflow-y-auto sm:max-w-sm"
        >
          <DialogHeader>
            <DialogTitle>{t('title')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {orderedLanguages.map((lang) => {
              const value = editedTexts[lang] ?? '';
              const isOverLimit = value.length > MAX_CARD_TEXT_LENGTH;
              return (
                <div key={lang} className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor={`edit-${lang}`}>
                      {getLocalizedLanguageNameByCode(lang, locale)}
                    </Label>
                    <span className={`text-xs tabular-nums ${isOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                      {isOverLimit
                        ? `+${value.length - MAX_CARD_TEXT_LENGTH}`
                        : `${value.length}/${MAX_CARD_TEXT_LENGTH}`}
                    </span>
                  </div>
                  <Input
                    id={`edit-${lang}`}
                    value={value}
                    onChange={(e) =>
                      setEditedTexts((prev) => ({
                        ...prev,
                        [lang]: e.target.value,
                      }))
                    }
                    className={isOverLimit ? 'border-destructive focus-visible:ring-destructive' : ''}
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
              disabled={isSaving || !hasChanges || hasOverLimit}
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
      {limitDialogOpen && (
        <UsageLimitDialog
          open={limitDialogOpen}
          setOpen={setLimitDialogOpen}
          featureId={FEATURE_IDS.CARD_EDITS}
        />
      )}
    </>
  );
}
