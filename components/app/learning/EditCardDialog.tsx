'use client';

import { useState, useLayoutEffect, useMemo } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { useMutation, useQuery } from 'convex/react';
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
import { Loader2, Trash2, Undo2 } from 'lucide-react';
import {
  getLocalizedLanguageNameByCode,
  getTextDirection,
} from '@/lib/languages';
import { ConvexError } from 'convex/values';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import UsageLimitDialog from '@/components/autumn/usage-limit-dialog';
import { MAX_CARD_TEXT_LENGTH } from '@/lib/constants/learning';
import { cn, isPaymentPastDueError } from '@/lib/utils';
import { useReloadBlock } from '@/components/app/AppUpdateGate';
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
  const updateAlternative = useMutation(
    api.features.writingAlternatives.updateAlternative,
  );
  const deleteAlternative = useMutation(
    api.features.writingAlternatives.deleteAlternative,
  );
  // The user's stored accepted alternatives (writing mode). Fetched here
  // rather than passed in: only the learning-mode payload carries them, and
  // the dialog also opens from the library and the word-stats sheet.
  const alternativeRows = useQuery(
    api.features.writingAlternatives.listForCard,
    open ? { cardId } : 'skip',
  );

  const [editedTexts, setEditedTexts] = useState<Record<string, string>>({});
  // Alternative drafts, keyed by row id. Seeded LAZILY (value ?? row.text)
  // because the rows arrive async after open; only edited ids are stored.
  const [editedAlternatives, setEditedAlternatives] = useState<
    Record<string, string>
  >({});
  const [deletedAlternatives, setDeletedAlternatives] = useState<Set<string>>(
    new Set(),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [limitDialogOpen, setLimitDialogOpen] = useState(false);

  // The dialog can be opened from LibraryView, outside LearnView's blanket
  // block, and its draft lives only in this state.
  useReloadBlock(open);

  useLayoutEffect(() => {
    if (open) {
      const initial: Record<string, string> = {};
      for (const tr of translations) {
        initial[tr.language] = tr.text;
      }
      setEditedTexts(initial);
      setEditedAlternatives({});
      setDeletedAlternatives(new Set());
    }
  }, [open, translations]);

  const alternativesByLanguage = useMemo(() => {
    const map = new Map<string, NonNullable<typeof alternativeRows>>();
    for (const row of alternativeRows ?? []) {
      map.set(row.language, [...(map.get(row.language) ?? []), row]);
    }
    return map;
  }, [alternativeRows]);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // The card edit burns card_edits quota and writes an audit row, so it
      // only runs when a sentence actually changed; alternative edits are
      // free per-user rows and go through their own mutations.
      if (hasChanges) {
        const translationArgs = Object.entries(editedTexts).map(
          ([language, text]) => ({ language, text }),
        );
        await editCard({
          cardId,
          translations: translationArgs,
          timezone: getUserTimezone(),
        });
      }
      for (const row of alternativeRows ?? []) {
        if (deletedAlternatives.has(row._id)) {
          await deleteAlternative({ alternativeId: row._id });
          continue;
        }
        const draft = editedAlternatives[row._id];
        if (draft !== undefined && draft !== row.text && draft.trim()) {
          await updateAlternative({ alternativeId: row._id, text: draft });
        }
      }
      onOpenChange(false);
    } catch (err) {
      if (isPaymentPastDueError(err)) {
        // Silent: the reactive payment-overdue dialog is the canonical
        // surface for this state.
      } else if (
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
  const hasAlternativeChanges =
    deletedAlternatives.size > 0 ||
    (alternativeRows ?? []).some(
      (row) =>
        !deletedAlternatives.has(row._id) &&
        editedAlternatives[row._id] !== undefined &&
        editedAlternatives[row._id] !== row.text,
    );

  const hasOverLimit =
    Object.values(editedTexts).some(
      (text) => text.length > MAX_CARD_TEXT_LENGTH,
    ) ||
    Object.values(editedAlternatives).some(
      (text) => text.length > MAX_CARD_TEXT_LENGTH,
    );
  // An emptied alternative blocks Save (deleting is the trash icon's job,
  // never a silent side effect of clearing a field).
  const hasEmptyAlternative = (alternativeRows ?? []).some(
    (row) =>
      !deletedAlternatives.has(row._id) &&
      editedAlternatives[row._id] !== undefined &&
      !editedAlternatives[row._id].trim(),
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
                    <span
                      className={`text-xs tabular-nums ${isOverLimit ? 'text-destructive font-medium' : 'text-muted-foreground'}`}
                    >
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
                    dir={getTextDirection(lang)}
                    className={cn(
                      'text-left',
                      isOverLimit &&
                        'border-destructive focus-visible:ring-destructive',
                    )}
                  />
                  {(alternativesByLanguage.get(lang)?.length ?? 0) > 0 && (
                    <div
                      className="space-y-1.5 pt-1"
                      data-testid={`edit-alternatives-${lang}`}
                    >
                      <p className="text-xs text-muted-foreground">
                        {t('alternativesLabel')}
                      </p>
                      {alternativesByLanguage.get(lang)!.map((row, altIdx) => {
                        const draft = editedAlternatives[row._id] ?? row.text;
                        const isDeleted = deletedAlternatives.has(row._id);
                        const altOverLimit =
                          draft.length > MAX_CARD_TEXT_LENGTH;
                        return (
                          <div
                            key={row._id}
                            className="flex items-center gap-1.5"
                          >
                            <Input
                              data-testid={`edit-alternative-input-${lang}-${altIdx}`}
                              value={draft}
                              disabled={isDeleted}
                              aria-invalid={!isDeleted && altOverLimit}
                              onChange={(e) =>
                                setEditedAlternatives((prev) => ({
                                  ...prev,
                                  [row._id]: e.target.value,
                                }))
                              }
                              dir={getTextDirection(lang)}
                              className={cn(
                                'text-left',
                                isDeleted && 'line-through opacity-50',
                                !isDeleted &&
                                  altOverLimit &&
                                  'border-destructive focus-visible:ring-destructive',
                              )}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              data-testid={`edit-alternative-delete-${lang}-${altIdx}`}
                              className="h-9 w-9 shrink-0 text-muted-foreground"
                              aria-label={
                                isDeleted
                                  ? t('undoDeleteAlternative')
                                  : t('deleteAlternative')
                              }
                              onClick={() =>
                                setDeletedAlternatives((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(row._id)) next.delete(row._id);
                                  else next.add(row._id);
                                  return next;
                                })
                              }
                            >
                              {isDeleted ? (
                                <Undo2 className="h-4 w-4" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter className="flex !flex-row w-full gap-2 [&>*]:min-w-0">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              data-testid="edit-card-cancel"
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
            >
              {t('cancel')}
            </Button>
            <Button
              type="button"
              className="flex-1"
              data-testid="edit-card-save"
              onClick={handleSave}
              disabled={
                isSaving ||
                (!hasChanges && !hasAlternativeChanges) ||
                hasOverLimit ||
                hasEmptyAlternative
              }
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
