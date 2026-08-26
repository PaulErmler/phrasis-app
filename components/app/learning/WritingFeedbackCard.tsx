'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, CircleAlert, CircleX } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FEATURE_IDS } from '@/convex/features/featureIds';
import { useLimitDialog } from '@/components/feature_tracking/useFeatureLock';
import type { WritingFeedbackResult } from '@/convex/features/writingFeedback';

/**
 * Per-language-row AI feedback state, owned by FullReviewCardContent.
 * 'error' renders nothing (the row falls back to the plain diff view); the
 * entry still exists so the kick-off effect doesn't refire the request.
 */
export interface RowFeedback {
  status: 'pending' | 'done' | 'error' | 'limit';
  result?: WritingFeedbackResult;
}

interface WritingFeedbackCardProps {
  feedback: RowFeedback;
  /** Opens chat with the discussAnswer quick action; absent outside learning mode. */
  onDiscuss?: () => void;
  /**
   * Turns the aiWritingFeedback course setting off. Offered on the
   * quota-reached line as the alternative to upgrading, so a free user who
   * doesn't want to pay isn't nagged on every answer.
   */
  onTurnOff?: () => void;
  /**
   * Replaces the card's sentence for this language with the grader's
   * corrected text (the existing editCard flow: audit log, curriculum fork,
   * audio regeneration). Offered as a prompt on "also correct" results; the
   * answer stays an accepted alternative either way. Rejects on quota/edit
   * errors — the caller surfaces those; this card just resets the prompt.
   */
  onMakeDefault?: () => Promise<void>;
}

const VERDICT_STYLE: Record<
  string,
  { bar: string; chip: string; icon: 'check' | 'alert' | 'x' }
> = {
  correct: {
    bar: 'bg-success',
    chip: 'bg-success/10 text-success',
    icon: 'check',
  },
  alsoCorrect: {
    bar: 'bg-primary',
    chip: 'bg-primary/10 text-primary',
    icon: 'check',
  },
  minor: {
    bar: 'bg-accent-orange',
    chip: 'bg-accent-orange/10 text-accent-orange',
    icon: 'alert',
  },
  partial: {
    bar: 'bg-accent-orange',
    chip: 'bg-accent-orange/10 text-accent-orange',
    icon: 'alert',
  },
  wrong: {
    bar: 'bg-destructive',
    chip: 'bg-destructive/10 text-destructive',
    icon: 'x',
  },
};

/**
 * Coach card rendered under the diff of a submitted writing answer (prototype
 * B of the design review). Compact by construction: verdict chip, at most two
 * typed notes, the corrected sentence when it differs, and a
 * "Discuss in detail" escalation into chat.
 */
export function WritingFeedbackCard({
  feedback,
  onDiscuss,
  onTurnOff,
  onMakeDefault,
}: WritingFeedbackCardProps) {
  const t = useTranslations('LearningMode.feedback');
  const { openLimitDialog, limitDialog } = useLimitDialog(
    FEATURE_IDS.AI_FEEDBACK,
  );
  const [makeDefault, setMakeDefault] = useState<'idle' | 'saving' | 'done'>(
    'idle',
  );

  if (feedback.status === 'error') return null;

  if (feedback.status === 'pending') {
    return (
      <div
        className="mt-2 flex flex-col gap-2"
        role="status"
        aria-label={t('checking')}
        data-testid="writing-feedback-pending"
      >
        <div className="h-5 w-28 animate-pulse rounded-full bg-muted" />
        <div className="h-3 w-4/5 animate-pulse rounded bg-muted" />
      </div>
    );
  }

  if (feedback.status === 'limit') {
    return (
      <div
        className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
        data-testid="writing-feedback-limit"
      >
        <span>{t('limitReached')}</span>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            className="h-7 px-2.5 text-xs"
            data-testid="writing-feedback-upgrade"
            onClick={openLimitDialog}
          >
            {t('limitUpgrade')}
          </Button>
          {onTurnOff && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-xs"
              data-testid="writing-feedback-turn-off"
              onClick={onTurnOff}
            >
              {t('limitTurnOff')}
            </Button>
          )}
        </div>
        {limitDialog}
      </div>
    );
  }

  const result = feedback.result;
  if (!result || result.verdict === 'error') return null;

  // Correct answers (exact or accepted-alternative match) render NOTHING:
  // the all-green diff at 100% already says it, and a chip repeating it is
  // noise. The feedback entry still exists so the kick-off effect won't
  // re-request, and the accepted-answers list under the row still shows the
  // other phrasings.
  if (result.verdict === 'correct') return null;

  const style = VERDICT_STYLE[result.verdict];
  const Icon =
    style.icon === 'check'
      ? Check
      : style.icon === 'alert'
        ? CircleAlert
        : CircleX;

  const verdictLabel = t(
    `verdict.${result.verdict}` as Parameters<typeof t>[0],
  );

  return (
    <div
      className="mt-2 overflow-hidden rounded-md border border-border bg-card"
      data-testid="writing-feedback-card"
    >
      <div className={`h-0.5 ${style.bar}`} />
      <div className="flex flex-col gap-2 px-3 py-2.5">
        <span
          className={`inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${style.chip}`}
        >
          <Icon className="h-3 w-3" />
          {verdictLabel}
        </span>
        {result.notes && result.notes.length > 0 && (
          <ul className="flex flex-col gap-1.5">
            {result.notes.map((note, i) => (
              <li key={i} className="text-sm">
                <span className="mr-1.5 inline-block rounded bg-muted px-1.5 py-px align-[1px] text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(`noteType.${note.type}` as Parameters<typeof t>[0])}
                </span>
                {note.text}
              </li>
            ))}
          </ul>
        )}
        {result.savedAlternative && (
          <p
            className="text-xs text-success"
            data-testid="writing-feedback-alternative-saved"
          >
            ✓ {t('savedAlternative')}
          </p>
        )}
        {makeDefault === 'done' && (
          <p
            className="text-xs text-success"
            data-testid="writing-feedback-make-default-done"
          >
            ✓ {t('makeDefaultDone')}
          </p>
        )}
        {(onDiscuss || onMakeDefault) && (
          <div className="flex flex-wrap items-center gap-2">
            {result.verdict === 'alsoCorrect' &&
              result.corrected &&
              onMakeDefault &&
              makeDefault !== 'done' && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  disabled={makeDefault === 'saving'}
                  data-testid="writing-feedback-make-default-confirm"
                  onClick={async () => {
                    setMakeDefault('saving');
                    try {
                      await onMakeDefault();
                      setMakeDefault('done');
                    } catch {
                      setMakeDefault('idle');
                    }
                  }}
                >
                  {makeDefault === 'saving'
                    ? t('makeDefaultSaving')
                    : t('makeDefaultConfirm')}
                </Button>
              )}
            {onDiscuss && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="ml-auto h-7 px-2.5 text-xs"
                data-testid="writing-feedback-discuss"
                onClick={onDiscuss}
              >
                {t('discussInDetail')}
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
