'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Authenticated } from 'convex/react';
import { LearningMode } from '@/components/app/LearningMode';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import {
  LearningChatLayout,
  useLearningChatToggle,
} from '@/components/app/learning/LearningChatLayout';
import {
  LearningHeader,
  useLearningMode,
  useLearningAudio,
} from '@/components/app/learning';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { createCardToolRenderer } from '@/components/chat/tools/CardToolRenderer';
import { useCardApprovals } from '@/hooks/use-card-approvals';
import type { CardContext } from '@/hooks/use-send-message';
import { useThread } from '@/hooks/use-thread';
import { Loader } from '@/components/ai-elements/loader';
import { useAppData } from '@/components/app/AppDataProvider';

function WrappedChatPanel({
  threadId,
  cardContext,
  onMessageSent,
  targetLanguages,
}: {
  threadId: string;
  cardContext?: CardContext;
  onMessageSent?: () => void;
  targetLanguages: string[];
}) {
  const { closeChat } = useLearningChatToggle();
  const approvals = useCardApprovals(threadId);
  const t = useTranslations('Chat');

  const suggestions = useMemo(
    () => [
      t('suggestions.explain'),
      t('suggestions.meaning'),
      t('suggestions.example'),
      t('suggestions.conversation'),
    ],
    [t],
  );

  const toolRenderers = useMemo(
    () => ({
      createCard: createCardToolRenderer({ ...approvals, targetLanguages }),
    }),
    [approvals, targetLanguages],
  );

  return (
    <ChatPanel
      threadId={threadId}
      toolRenderers={toolRenderers}
      cardContext={cardContext}
      onMessageSent={onMessageSent}
      suggestions={suggestions}
      showSuggestions
      aboveFooterAction={
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={closeChat}
          className="h-9 w-9 shrink-0"
          aria-label={t('back')}
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      }
    />
  );
}

interface LearnViewProps {
  onBack: () => void;
}

export function LearnView({ onBack }: LearnViewProps) {
  return (
    <Authenticated>
      <LearnViewInner onBack={onBack} />
    </Authenticated>
  );
}

function LearnViewInner({ onBack }: LearnViewProps) {
  const { preloadedCourseSettings, preloadedActiveCourse } = useAppData();

  const [isNavigating, setIsNavigating] = useState(false);

  const state = useLearningMode({
    courseSettings: preloadedCourseSettings,
    activeCourse: preloadedActiveCourse,
  });
  const { audio, openSettings } = useLearningAudio(state);

  const goHome = useCallback(() => {
    audio.pause();
    setIsNavigating(true);
    onBack();
  }, [audio, onBack]);

  const { threadId, isLoading: isThreadLoading, createThread } = useThread({
    autoCreate: true,
  });

  const threadHasMessagesRef = useRef(false);
  const prevCardIdRef = useRef<string | null>(null);
  const currentCardId = state.status === 'reviewing' ? state.cardId : null;

  useEffect(() => {
    if (!currentCardId) return;
    if (prevCardIdRef.current === null) {
      prevCardIdRef.current = currentCardId;
      return;
    }
    if (prevCardIdRef.current === currentCardId) return;

    prevCardIdRef.current = currentCardId;

    if (threadHasMessagesRef.current) {
      threadHasMessagesRef.current = false;
      createThread().catch((err) =>
        console.error('Failed to create new thread on card change:', err),
      );
    }
  }, [currentCardId, createThread]);

  const handleMessageSent = useCallback(() => {
    audio.pause();
    threadHasMessagesRef.current = true;
  }, [audio]);

  const handleChatOpen = useCallback(() => {
    audio.pause();
  }, [audio]);

  const cardContext: CardContext | undefined = useMemo(() => {
    if (state.status !== 'reviewing') return undefined;
    return {
      sourceText: state.sourceText,
      sourceLanguage: state.sourceLanguage,
      translations: state.translations.map((t) => ({
        language: t.language,
        text: t.text,
      })),
      baseLanguages: state.baseLanguages,
      targetLanguages: state.targetLanguages,
    };
  }, [state]);

  const targetLanguages =
    state.status !== 'loading' ? state.targetLanguages : [];

  const chatPanel = threadId ? (
    <WrappedChatPanel
      threadId={threadId}
      cardContext={cardContext}
      onMessageSent={handleMessageSent}
      targetLanguages={targetLanguages}
    />
  ) : isThreadLoading ? (
    <div className="flex-1 flex items-center justify-center">
      <Loader size={24} />
    </div>
  ) : null;

  const header = (
    <LearningHeader
      onBack={goHome}
      onSettingsOpen={openSettings}
      isNavigating={isNavigating}
    />
  );

  return (
    <LearningChatLayout
      header={header}
      chatPanel={chatPanel}
      onChatOpen={handleChatOpen}
    >
      <LearningMode state={state} audio={audio} onGoHome={goHome} />
    </LearningChatLayout>
  );
}
