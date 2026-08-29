'use client';

import { usePaginatedQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { languageName } from '@/lib/languages';

export function UserTextsBrowser({ userId }: { userId: string }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.admin.userContent.listUserTexts,
    { userId },
    { initialNumItems: 20 },
  );

  if (status === 'LoadingFirstPage') {
    return (
      <div className="card-surface p-4 text-center text-muted-foreground text-sm">
        Loading…
      </div>
    );
  }

  return (
    <div className="card-surface p-3 space-y-3">
      {results.length === 0 && (
        <p className="py-4 text-center text-muted-foreground text-sm">
          No custom cards
        </p>
      )}
      {results.map((text) => (
        <div key={text._id} className="rounded-lg border border-border/50 p-3">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-medium">{text.text}</p>
            <div className="flex shrink-0 items-center gap-1">
              <Badge variant="secondary" className="text-[10px]">
                {languageName(text.language)}
              </Badge>
              {text.origin && text.origin !== 'premade' && (
                <Badge variant="outline" className="text-[10px]">
                  {text.origin}
                </Badge>
              )}
            </div>
          </div>
          {text.translations.length > 0 && (
            <div className="mt-2 space-y-0.5">
              {text.translations.map((t, i) => (
                <p key={i} className="text-xs text-muted-foreground">
                  <span className="font-medium">
                    {languageName(t.language)}:
                  </span>{' '}
                  {t.text}
                </p>
              ))}
            </div>
          )}
          <p className="mt-2 text-[10px] text-muted-foreground">
            {new Date(text._creationTime).toLocaleString()}
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
  );
}
