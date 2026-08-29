'use client';

import { useTranslations } from 'next-intl';
import {
  ChevronLeft,
  CornerDownLeft,
  MessageSquarePlus,
  Mic,
  PanelLeft,
  Pencil,
} from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Message, MessageContent } from '@/components/ai-elements/message';
import { ThemeSwitcher } from '@/components/ThemeSwitcher';
import { BottomNav } from '@/components/app/BottomNav';
import { CHAT_THREAD } from '../fixtures';

/** Sentence lines exactly as CardApproval.tsx:46-73 renders them. */
function EntryLines({ base, target }: { base: string; target: string }) {
  return (
    <div className="space-y-1.5 text-sm">
      <p className="text-sm text-muted-foreground">
        <span className="font-medium text-muted-foreground uppercase text-xs">
          EN
        </span>{' '}
        <span>{base}</span>
      </p>
      <p className="text-base font-semibold">
        <span className="font-medium text-muted-foreground uppercase text-xs">
          ES
        </span>{' '}
        <span>{target}</span>
      </p>
    </div>
  );
}

/** Replica of the resolved/pending approval card (CardApproval.tsx:207-302). */
function ApprovalCard({
  base,
  target,
  state,
}: {
  base: string;
  target: string;
  state: 'approved' | 'pending';
}) {
  const t = useTranslations('Chat.cardApproval');
  const approved = state === 'approved';
  return (
    <Alert
      className={
        approved
          ? 'my-3 flex flex-col gap-3 border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950'
          : 'my-3 flex flex-col gap-3'
      }
    >
      <AlertDescription>
        <EntryLines base={base} target={target} />
      </AlertDescription>
      <div className="flex w-full items-center gap-2 h-8">
        {approved ? (
          <Button
            disabled
            variant="ghost"
            size="sm"
            className="h-8 px-3 text-xs font-medium hover:bg-transparent disabled:opacity-100 text-success"
          >
            {t('approved')}
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" className="h-8 px-3 text-sm">
              {t('rejectButton')}
            </Button>
            <Button size="sm" className="h-8 px-3 text-sm">
              {t('approveButton')}
            </Button>
            <Button variant="outline" size="icon" className="ml-auto h-8 w-8">
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </Alert>
  );
}

export function ChatScreen() {
  const t = useTranslations('Chat');
  const tApp = useTranslations('AppPage');
  const thread = CHAT_THREAD;

  return (
    <div className="h-dvh max-h-dvh flex flex-col overflow-hidden bg-background text-foreground">
      {/* Chat header (app/app/(main)/layout.tsx chat variant) */}
      <header className="fixed top-0 left-0 right-0 z-20 border-b bg-background pt-[env(safe-area-inset-top)]">
        <div className="header-bar">
          <div className="flex items-center gap-1">
            <Button variant="ghost" className="gap-2 -ml-2">
              <ChevronLeft className="h-4 w-4" />
              {tApp('views.chat')}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Toggle conversations"
            >
              <PanelLeft className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="New chat">
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-1 -mr-2 shrink-0">
            <ThemeSwitcher />
          </div>
        </div>
      </header>
      <div className="shrink-0 h-[calc(3.5rem+env(safe-area-inset-top))]" />

      {/* Thread */}
      <div className="flex-1 min-h-0 relative px-4 pt-2 w-full max-w-xl mx-auto overflow-hidden">
        <div className="h-full overflow-y-auto">
          <div className="flex flex-col gap-8 p-4">
            <Message from="user">
              <MessageContent>{thread.userQuestion}</MessageContent>
            </Message>

            <Message from="assistant">
              <MessageContent>
                <p>
                  For <em>yo</em> (I), estar becomes <strong>estoy</strong> —
                  e.g. <em>Estoy bien</em>. For <em>ellos/ellas</em> (they)
                  it&apos;s <strong>están</strong>. Here are two cards so it
                  sticks:
                </p>
                {thread.cards.map((card) => (
                  <ApprovalCard
                    key={card.target}
                    base={card.base}
                    target={card.target}
                    state={card.state}
                  />
                ))}
              </MessageContent>
            </Message>
          </div>
        </div>
      </div>

      {/* Input bar (ChatPanel footer + ChatInput) */}
      <div className="flex-none border-t bg-background pb-16">
        <div className="p-4 max-w-xl mx-auto">
          <div className="rounded-xl border bg-background shadow-sm">
            <textarea
              readOnly
              rows={2}
              placeholder={t('input.placeholder')}
              className="w-full resize-none bg-transparent px-3 pt-2.5 text-sm outline-none placeholder:text-muted-foreground"
            />
            <div className="flex items-center justify-between gap-1 px-2 pb-2">
              <span />
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground"
                >
                  <Mic className="h-4 w-4" />
                </Button>
                <Button size="icon" className="h-8 w-8">
                  <CornerDownLeft className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-20">
        <BottomNav
          currentView="chat"
          onViewChange={() => {}}
          onLearnOpen={() => {}}
        />
      </div>
    </div>
  );
}
