'use client';

import { useState } from 'react';
import { usePaginatedQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Extract readable text from an agent UIMessage: prefer the convenience
 * `text` field, fall back to concatenating text parts.
 */
function messageText(message: any): string {
  if (typeof message?.text === 'string' && message.text.length > 0) {
    return message.text;
  }
  const parts = Array.isArray(message?.parts) ? message.parts : [];
  return parts
    .filter((p: any) => p?.type === 'text' && typeof p.text === 'string')
    .map((p: any) => p.text)
    .join('\n');
}

function ThreadMessages({ userId, threadId }: { userId: string; threadId: string }) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.admin.userContent.listThreadMessages,
    { userId, threadId },
    { initialNumItems: 25 },
  );

  if (status === 'LoadingFirstPage') {
    return <div className="py-6 text-center text-muted-foreground text-sm">Loading…</div>;
  }

  return (
    <div className="space-y-2">
      {results.map((message: any, i: number) => {
        const text = messageText(message);
        const isUser = message?.role === 'user';
        if (!text) return null;
        return (
          <div
            key={message?.key ?? message?._id ?? i}
            className={cn('flex', isUser ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[85%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap break-words',
                isUser ? 'bg-primary text-primary-foreground' : 'bg-muted',
              )}
            >
              {text}
            </div>
          </div>
        );
      })}
      {status === 'CanLoadMore' && (
        <div className="text-center pt-1">
          <Button variant="outline" size="sm" onClick={() => loadMore(25)}>
            Load more
          </Button>
        </div>
      )}
      {results.length === 0 && (
        <p className="py-4 text-center text-muted-foreground text-sm">No messages</p>
      )}
    </div>
  );
}

export function UserThreadsBrowser({ userId }: { userId: string }) {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const { results, status, loadMore } = usePaginatedQuery(
    api.admin.userContent.listUserThreads,
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
    <div className="grid gap-3 md:grid-cols-[280px_1fr]">
      <div className="card-surface p-2 space-y-1 self-start">
        {results.length === 0 && (
          <p className="p-3 text-sm text-muted-foreground">No chat threads</p>
        )}
        {results.map((thread) => (
          <button
            key={thread._id}
            onClick={() => setSelectedThreadId(thread._id)}
            className={cn(
              'w-full text-left rounded-md px-3 py-2 text-sm transition-colors',
              selectedThreadId === thread._id ? 'bg-muted' : 'hover:bg-muted/50',
            )}
          >
            <span className="block truncate font-medium">
              {thread.title || 'Untitled'}
            </span>
            <span className="flex items-center gap-2 text-xs text-muted-foreground">
              {new Date(thread._creationTime).toLocaleDateString()}
              {thread.status === 'archived' && (
                <Badge variant="outline" className="text-[10px] px-1 py-0">
                  empty
                </Badge>
              )}
            </span>
          </button>
        ))}
        {status === 'CanLoadMore' && (
          <div className="text-center pt-1">
            <Button variant="ghost" size="sm" onClick={() => loadMore(20)}>
              Load more
            </Button>
          </div>
        )}
      </div>
      <div className="card-surface p-3 min-h-[200px]">
        {selectedThreadId ? (
          <ThreadMessages userId={userId} threadId={selectedThreadId} />
        ) : (
          <p className="py-8 text-center text-muted-foreground text-sm">
            Select a thread to read its messages
          </p>
        )}
      </div>
    </div>
  );
}
