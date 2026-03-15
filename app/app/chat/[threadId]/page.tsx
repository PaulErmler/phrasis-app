'use client';

import { ChatPanel } from '@/components/chat/ChatPanel';
import { createCardToolRenderer } from '@/components/chat/tools/CardToolRenderer';
import { useCardApprovals } from '@/hooks/use-card-approvals';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { Button } from '@/components/ui/button';
import { ChevronLeft, Loader2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { Authenticated, AuthLoading } from 'convex/react';
import { use, useMemo } from 'react';
import { useTranslations } from 'next-intl';

export default function ChatPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = use(params);

  return (
    <>
      <AuthLoading>
        <div className="h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AuthLoading>
      <Authenticated>
        <ChatPageContent threadId={threadId} />
      </Authenticated>
    </>
  );
}

function ChatPageContent({ threadId }: { threadId: string }) {
  const router = useRouter();
  const t = useTranslations('Chat');
  const approvals = useCardApprovals(threadId);

  const toolRenderers = useMemo(
    () => ({
      createCard: createCardToolRenderer(approvals),
    }),
    [approvals],
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="sticky-header">
        <div className="header-bar">
          <Button variant="ghost" className="gap-2 -ml-2" onClick={() => router.back()}>
            <ChevronLeft className="h-4 w-4" />
            {t('back')}
          </Button>
          <ThemeSwitcher />
        </div>
      </header>

      <main className="flex-1 min-h-0 relative">
        <ChatPanel
          threadId={threadId}
          toolRenderers={toolRenderers}
          className="max-w-3xl mx-auto"
        />
      </main>
    </div>
  );
}
