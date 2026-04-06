import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import type { Thread } from '@/lib/types/chat';

interface ThreadSidebarProps {
  threads: Thread[] | undefined;
  threadId: string | null;
  onThreadSelect: (id: string) => void;
  onNewThread: () => void;
  isCreating: boolean;
}

/**
 * Sidebar component for displaying and managing conversation threads
 */
export function ThreadSidebar({
  threads,
  threadId,
  onThreadSelect,
  onNewThread,
  isCreating,
}: ThreadSidebarProps) {
  const t = useTranslations('Chat.sidebar');
  return (
    <aside className="w-64 border-r border-border bg-background/50 flex flex-col">
      <div className="p-4 border-b border-border">
        <h2 className="heading-section">{t('title')}</h2>
      </div>
      <div className="flex-1 overflow-y-auto">
        {threads && threads.length > 0 ? (
          <div className="p-2 space-y-1">
            {threads.map((thread) => (
              <button
                key={thread._id}
                onClick={() => onThreadSelect(thread._id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  threadId === thread._id
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-accent'
                }`}
              >
                <div className="font-medium truncate">
                  {thread.title || t('newChat')}
                </div>
                {thread.summary && (
                  <div className="text-xs opacity-70 truncate mt-1">
                    {thread.summary}
                  </div>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="p-4 text-center text-muted-sm">
            {t('noConversations')}
          </div>
        )}
      </div>
      <div className="p-4 border-t border-border">
        <Button
          onClick={onNewThread}
          className="w-full"
          variant="outline"
          disabled={isCreating}
        >
          {isCreating ? t('creating') : t('newChat')}
        </Button>
      </div>
    </aside>
  );
}
