'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Textarea } from '@/components/ui/textarea';
import {
  coursePolitenessRows,
  type PolitenessLevel,
} from '@/lib/languageForms';
import type { FlagReason } from '@/convex/types';
import { usePolitenessRowCopy } from '@/components/course/PolitenessRows';

/** What the dialog hands back; mirrors `flagTranslation`'s args. */
export interface FlagSubmission {
  reasons: FlagReason[];
  note?: string;
  requestedGender?: 'male' | 'female';
  requestedPolitenessLevel?: PolitenessLevel;
}

const REASONS: FlagReason[] = [
  'wrong_translation',
  'wrong_gender',
  'wrong_politeness',
  'other',
];

const NOTE_MAX_LENGTH = 500;

/**
 * The Flag dialog: a multi-select of what is wrong, with a gender pick under
 * "wrong speaker gender" and a politeness pick under "wrong politeness".
 * The two picks are offered only for curriculum cards (`allowCorrections`):
 * a learner's own sentence has no shared rendering to correct. The
 * politeness rows come from the same `coursePolitenessRows` the course
 * settings use, so the levels named here are the ones the course knows.
 */
export function FlagTranslationDialog({
  open,
  onOpenChange,
  onSubmit,
  courseLanguages,
  allowCorrections,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (submission: FlagSubmission) => void;
  /** Base + target languages of the course, for the politeness rows. */
  courseLanguages: readonly string[];
  allowCorrections: boolean;
}) {
  const t = useTranslations('LearningMode.actions');
  const [reasons, setReasons] = useState<Set<FlagReason>>(() => new Set());
  const [note, setNote] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | undefined>();
  const [level, setLevel] = useState<PolitenessLevel | undefined>();

  const politenessRows = useMemo(
    () => coursePolitenessRows(courseLanguages),
    [courseLanguages],
  );
  const rowCopy = usePolitenessRowCopy();

  const toggle = (reason: FlagReason, on: boolean) => {
    setReasons((prev) => {
      const next = new Set(prev);
      if (on) next.add(reason);
      else next.delete(reason);
      return next;
    });
  };

  const reset = () => {
    setReasons(new Set());
    setNote('');
    setGender(undefined);
    setLevel(undefined);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const submit = () => {
    const picked = REASONS.filter((r) => reasons.has(r));
    if (picked.length === 0) return;
    onSubmit({
      reasons: picked,
      note: reasons.has('other') ? note.trim() || undefined : undefined,
      requestedGender:
        allowCorrections && reasons.has('wrong_gender') ? gender : undefined,
      requestedPolitenessLevel:
        allowCorrections && reasons.has('wrong_politeness') ? level : undefined,
    });
    reset();
  };

  const showGenderPick = allowCorrections && reasons.has('wrong_gender');
  const showPolitenessPick =
    allowCorrections &&
    reasons.has('wrong_politeness') &&
    politenessRows.length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm" data-testid="flag-dialog">
        <DialogHeader>
          <DialogTitle>{t('flagDialogTitle')}</DialogTitle>
          <DialogDescription>{t('flagDialogDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            {REASONS.map((reason) => (
              <label
                key={reason}
                className="flex cursor-pointer select-none items-center gap-2 text-sm"
              >
                <Checkbox
                  checked={reasons.has(reason)}
                  onCheckedChange={(v) => toggle(reason, v === true)}
                  data-testid={`flag-reason-${reason}`}
                />
                <span>{t(`flagReason_${reason}`)}</span>
              </label>
            ))}
          </div>

          {showGenderPick && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">{t('flagGenderPrompt')}</p>
              <RadioGroup
                value={gender ?? ''}
                onValueChange={(v) => setGender(v as 'male' | 'female')}
                className="gap-2"
              >
                {(['male', 'female'] as const).map((g) => (
                  <label
                    key={g}
                    className="flex cursor-pointer items-center gap-2 text-sm"
                  >
                    <RadioGroupItem
                      value={g}
                      data-testid={`flag-gender-${g}`}
                    />
                    <span>{t(`flagGender_${g}`)}</span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}

          {showPolitenessPick && (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm font-medium">{t('flagPolitenessPrompt')}</p>
              <RadioGroup
                value={level ?? ''}
                onValueChange={(v) => setLevel(v as PolitenessLevel)}
                className="gap-2"
              >
                {politenessRows.map((row) => (
                  <label
                    key={row.level}
                    className="flex cursor-pointer items-start gap-2 text-sm"
                  >
                    <RadioGroupItem
                      value={row.level}
                      className="mt-0.5"
                      data-testid={`flag-politeness-${row.level}`}
                    />
                    <span>
                      <span>{rowCopy.title(row)}</span>
                      <span className="block text-xs text-muted-foreground">
                        {rowCopy.subline(row)}
                      </span>
                    </span>
                  </label>
                ))}
              </RadioGroup>
            </div>
          )}

          {reasons.has('other') && (
            <div className="space-y-1.5">
              <Label htmlFor="flag-note" className="sr-only">
                {t('flagNoteLabel')}
              </Label>
              <Textarea
                id="flag-note"
                value={note}
                maxLength={NOTE_MAX_LENGTH}
                placeholder={t('flagNotePlaceholder')}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                data-testid="flag-note"
              />
            </div>
          )}
        </div>
        <DialogFooter className="flex !flex-row w-full gap-2 [&>*]:min-w-0">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={() => handleOpenChange(false)}
            data-testid="flag-cancel"
          >
            {t('flagConfirmCancel')}
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={reasons.size === 0}
            onClick={submit}
            data-testid="flag-submit"
          >
            {t('flagConfirmConfirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
