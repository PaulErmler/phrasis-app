'use client';

import { useTranslations, useFormatter } from 'next-intl';
import { MessageSquarePlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { Thread } from '@/lib/types/chat';
import { cn } from '@/lib/utils';

interface ChatHistorySidebarProps {
  threads: Thread[] | undefined;
  currentThreadId: string | null;
  onThreadSelect: (id: string) => void;
  onNewChat: () => void;
  isCreating?: boolean;
  className?: string;
}

function useThreadLabel(creationTime: number): string {
  const format = useFormatter();
  const date = new Date(creationTime);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (isToday) {
    return format.dateTime(date, { hour: 'numeric', minute: 'numeric' });
  }
  return format.dateTime(date, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
  });
}

function ThreadItem({
  thread,
  isActive,
  onSelect,
}: {
  thread: Thread;
  isActive: boolean;
  onSelect: () => void;
}) {
  const label = useThreadLabel(thread._creationTime);

  return (
    <button
      onClick={onSelect}
      className={cn(
        'w-full text-left px-3 py-2.5 rounded-md text-sm transition-colors',
        isActive
          ? 'bg-accent text-accent-foreground'
          : 'hover:bg-accent/50',
      )}
    >
      <div className="font-medium truncate">
        {thread.title && thread.title !== 'New Chat' ? thread.title : label}
      </div>
    </button>
  );
}

export function ChatHistorySidebar({
  threads,
  currentThreadId,
  onThreadSelect,
  onNewChat,
  isCreating,
  className,
}: ChatHistorySidebarProps) {
  const t = useTranslations('Chat.sidebar');
  const recentThreads = threads?.slice(0, 10);

  return (
    <div className={cn('flex flex-col h-full bg-background', className)}>
      <div className="p-4">
        <Button
          onClick={onNewChat}
          disabled={isCreating}
          className="w-full gap-2"
          variant="outline"
        >
          <MessageSquarePlus className="h-4 w-4" />
          {t('newChat')}
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {recentThreads && recentThreads.length > 0 ? (
          <div className="px-2 pb-4 space-y-1">
            {recentThreads.map((thread) => (
              <ThreadItem
                key={thread._id}
                thread={thread}
                isActive={currentThreadId === thread._id}
                onSelect={() => onThreadSelect(thread._id)}
              />
            ))}
          </div>
        ) : threads !== undefined ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {t('noConversations')}
          </div>
        ) : null}
      </ScrollArea>
    </div>
  );
}
