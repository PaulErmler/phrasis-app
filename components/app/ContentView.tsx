'use client';

import { useState, useCallback } from 'react';
import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { useTranslations } from 'next-intl';
import { MessageSquare, Upload, PenLine, ChevronRight, Loader2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';

export function ContentView({ onChatOpen }: { onChatOpen: (threadId: string) => void }) {
  const t = useTranslations('AppPage');
  const getOrCreateEmptyThread = useMutation(
    api.features.chat.threads.getOrCreateEmptyThread,
  );
  const [isNavigating, setIsNavigating] = useState(false);

  const handleGoToChat = useCallback(async () => {
    setIsNavigating(true);
    try {
      const threadId = await getOrCreateEmptyThread({});
      onChatOpen(threadId);
    } catch (error) {
      console.error('Failed to open chat:', error);
      toast.error('Failed to open chat');
    } finally {
      setIsNavigating(false);
    }
  }, [getOrCreateEmptyThread, onChatOpen]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-8">
      <div className="app-view space-y-3">
        <button
          onClick={handleGoToChat}
          disabled={isNavigating}
          className="card-surface p-4 flex items-center gap-4 transition-colors hover:bg-muted/50 w-full text-left disabled:opacity-70"
        >
          <div className="p-2.5 rounded-lg bg-primary/10 text-primary shrink-0">
            {isNavigating ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <MessageSquare className="h-5 w-5" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base leading-none mb-1">
              {t('content.chat.title')}
            </h3>
            <p className="text-muted-sm">{t('content.chat.description')}</p>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
        </button>

        <div className="card-surface p-4 flex items-center gap-4 opacity-50 cursor-not-allowed">
          <div className="p-2.5 rounded-lg bg-muted text-muted-foreground shrink-0">
            <Upload className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base leading-none mb-1 flex items-center gap-2">
              {t('content.fileUpload.title')}
              <Badge variant="secondary" className="text-[10px] font-medium">
                {t('content.comingSoon')}
              </Badge>
            </h3>
            <p className="text-muted-sm">{t('content.fileUpload.description')}</p>
          </div>
        </div>

        <div className="card-surface p-4 flex items-center gap-4 opacity-50 cursor-not-allowed">
          <div className="p-2.5 rounded-lg bg-muted text-muted-foreground shrink-0">
            <PenLine className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-base leading-none mb-1 flex items-center gap-2">
              {t('content.enterTexts.title')}
              <Badge variant="secondary" className="text-[10px] font-medium">
                {t('content.comingSoon')}
              </Badge>
            </h3>
            <p className="text-muted-sm">{t('content.enterTexts.description')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
