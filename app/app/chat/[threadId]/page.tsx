'use client';

import { ChatPanel } from '@/components/chat/ChatPanel';
import { createFlashcardToolRenderer } from '@/components/chat/tools/FlashcardToolRenderer';
import { useFlashcardApprovals } from '@/hooks/use-flashcard-approvals';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import Link from 'next/link';
import { RedirectToSignIn } from '@daveyplate/better-auth-ui';
import { Authenticated } from 'convex/react';
import { use, useMemo } from 'react';

export default function ChatPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = use(params);

  return (
    <>
      <RedirectToSignIn />
      <Authenticated>
        <ChatPageContent threadId={threadId} />
      </Authenticated>
    </>
  );
}

function ChatPageContent({ threadId }: { threadId: string }) {
  const approvals = useFlashcardApprovals(threadId);

  const toolRenderers = useMemo(
    () => ({
      createFlashcard: createFlashcardToolRenderer(approvals),
    }),
    [approvals],
  );

  return (
    <div className="flex flex-col h-screen overflow-hidden">
      <header className="sticky-header">
        <div className="header-bar">
          <Link href="/app">
            <Button variant="ghost" className="gap-2 -ml-2">
              <ChevronLeft className="h-4 w-4" />
              Back
            </Button>
          </Link>
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
