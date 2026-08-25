'use client';

import { useState } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getLanguageByCode, getTextDirection } from '@/lib/languages';

/**
 * QC feed for the card-edit audit log. Two questions per row: was the user's
 * edit an improvement, and did the retranslation it triggered come back
 * correct? Both need the before and after side by side, which is why every
 * changed language renders as a pair rather than just the new wording.
 */

type EditKind = 'manual_edit' | 'chat_also_correct' | 'flag';

const KIND_FILTERS: Array<{ value: EditKind | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'manual_edit', label: 'Manual edit' },
  { value: 'chat_also_correct', label: 'Chat replace' },
  { value: 'flag', label: 'Flag' },
];

const KIND_LABELS: Record<EditKind, string> = {
  manual_edit: 'manual edit',
  chat_also_correct: 'chat replace',
  flag: 'flag',
};

// Green = the retranslation landed. Amber = still in flight or deliberately
// not attempted. Red = it was meant to land and didn't.
const STATUS_TONE: Record<string, string> = {
  applied: 'text-emerald-600 dark:text-emerald-400',
  applied_audio_kept: 'text-emerald-600 dark:text-emerald-400',
  enqueued: 'text-amber-600 dark:text-amber-400',
  skipped_capped: 'text-muted-foreground',
  skipped_claim_contested: 'text-muted-foreground',
  refused_user_created: 'text-muted-foreground',
  fell_back_to_google: 'text-amber-600 dark:text-amber-400',
  dropped_superseded: 'text-destructive',
  dropped_text_deleted: 'text-destructive',
  failed: 'text-destructive',
};

function languageName(code: string): string {
  return getLanguageByCode(code)?.name ?? code;
}

function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export function CardEditsBrowser() {
  const [kind, setKind] = useState<EditKind | 'all'>('all');
  const { results, status, loadMore } = usePaginatedQuery(
    api.admin.cardEdits.listCardEdits,
    kind === 'all' ? {} : { kind },
    { initialNumItems: 20 },
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap justify-end gap-3 text-xs">
        {KIND_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setKind(f.value)}
            className={cn(
              'transition-colors',
              kind === f.value
                ? 'text-primary font-medium'
                : 'text-muted-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {status === 'LoadingFirstPage' ? (
        <div className="card-surface p-4 text-center text-muted-foreground text-sm">
          Loading…
        </div>
      ) : (
        <div className="card-surface p-3 space-y-3">
          {results.length === 0 && (
            <p className="py-4 text-center text-muted-foreground text-sm">
              No card edits yet
            </p>
          )}
          {results.map((edit) => (
            <div
              key={edit._id}
              className="rounded-lg border border-border/50 p-3"
            >
              <div className="flex items-start justify-between gap-2">
                <p
                  className="text-sm font-medium"
                  dir={getTextDirection(edit.sourceLanguage)}
                >
                  {edit.sourceText}
                </p>
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                  <Badge variant="secondary" className="text-[10px]">
                    {KIND_LABELS[edit.kind]}
                  </Badge>
                  {edit.path === 'fork' && (
                    <Badge variant="outline" className="text-[10px]">
                      forked
                    </Badge>
                  )}
                  {edit.collectionOrigin && (
                    <Badge variant="outline" className="text-[10px]">
                      {edit.collectionOrigin}
                    </Badge>
                  )}
                  {edit.textWasUserCreated && (
                    <Badge variant="outline" className="text-[10px]">
                      own sentence
                    </Badge>
                  )}
                </div>
              </div>

              <div className="mt-2 space-y-1.5">
                {edit.changes.map((change) => (
                  <div key={change.language} className="text-xs">
                    <span className="font-medium">
                      {languageName(change.language)}
                    </span>{' '}
                    <span className="text-muted-foreground">
                      ({change.role}
                      {change.isSourceLanguage ? ', source' : ''}
                      {change.soundsSame ? ', sounds same' : ''}
                      {change.beforeFlagCount
                        ? `, ${change.beforeFlagCount} prior flag(s)`
                        : ''}
                      )
                    </span>
                    <div
                      className="mt-0.5 space-y-0.5"
                      dir={getTextDirection(change.language)}
                    >
                      <p className="text-muted-foreground line-through">
                        {change.before || '—'}
                      </p>
                      {/* Flags carry no replacement wording; only edits do. */}
                      {change.after !== undefined && <p>{change.after}</p>}
                    </div>
                  </div>
                ))}
              </div>

              {edit.retranslations.length > 0 && (
                <div className="mt-3 space-y-1.5 border-t border-border/50 pt-2">
                  <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                    Retranslations of the shared sentence
                  </p>
                  {edit.retranslations.map((r) => (
                    <div key={r._id} className="text-xs">
                      <span className="font-medium">
                        {languageName(r.language)}
                      </span>{' '}
                      <span className={cn('font-medium', STATUS_TONE[r.status])}>
                        {statusLabel(r.status)}
                      </span>
                      {r.rule && (
                        <span className="text-muted-foreground"> · {r.rule}</span>
                      )}
                      <div
                        className="mt-0.5 space-y-0.5"
                        dir={getTextDirection(r.language)}
                      >
                        <p className="text-muted-foreground line-through">
                          {r.beforeText || '—'}
                        </p>
                        {r.userSuggestion !== undefined && (
                          <p className="text-muted-foreground">
                            suggested: {r.userSuggestion}
                          </p>
                        )}
                        {r.afterText !== undefined && <p>{r.afterText}</p>}
                      </div>
                      {r.afterTranslationSource && (
                        <p className="text-[10px] text-muted-foreground">
                          {r.afterTranslationSource}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <p className="mt-2 text-[10px] text-muted-foreground">
                {new Date(edit._creationTime).toLocaleString()} · {edit.userId}
              </p>
            </div>
          ))}
          {status === 'CanLoadMore' && (
            <div className="text-center">
              <Button variant="outline" size="sm" onClick={() => loadMore(20)}>
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
