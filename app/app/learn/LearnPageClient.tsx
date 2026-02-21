'use client';

import { useRouter } from 'next/navigation';
import { useMemo } from 'react';
import { Preloaded } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { RedirectToSignIn } from '@daveyplate/better-auth-ui';
import { Authenticated } from 'convex/react';
import { LearningMode } from '@/components/app/LearningMode';
import { Button } from '@/components/ui/button';
import { ChevronLeft } from 'lucide-react';
import { LearningChatLayout, useLearningChatToggle } from '@/components/app/learning/LearningChatLayout';
import {
  LearningHeader,
  useLearningMode,
  useLearningAudio,
} from '@/components/app/learning';
import { ChatPanel } from '@/components/chat/ChatPanel';
import { createFlashcardToolRenderer } from '@/components/chat/tools/FlashcardToolRenderer';
import { useFlashcardApprovals } from '@/hooks/use-flashcard-approvals';
import { useThread } from '@/hooks/use-thread';
import { Loader } from '@/components/ai-elements/loader';

const LEARNING_SUGGESTIONS = [
  'Explain this sentence to me.',
  'What does this word mean?',
  'Give me a similar example.',
  'How would I use this in a conversation?',
] as const;

function WrappedChatPanel({ threadId }: { threadId: string }) {
  const { closeChat } = useLearningChatToggle();
  const approvals = useFlashcardApprovals(threadId);

  const toolRenderers = useMemo(
    () => ({
      createFlashcard: createFlashcardToolRenderer(approvals),
    }),
    [approvals],
  );

  return (
    <ChatPanel
      threadId={threadId}
      toolRenderers={toolRenderers}
      suggestions={LEARNING_SUGGESTIONS}
      showSuggestions
      aboveFooterAction={
        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={closeChat}
          className="h-9 w-9 shrink-0"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>
      }
    />
  );
}

export function LearnPageClient({
  preloadedCard,
  preloadedCourseSettings,
  preloadedActiveCourse,
}: {
  preloadedCard: Preloaded<typeof api.features.scheduling.getCardForReview>;
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
  preloadedActiveCourse: Preloaded<typeof api.features.courses.getActiveCourse>;
}) {
  return (
    <>
      <RedirectToSignIn />
      <Authenticated>
        <LearnPageInner
          preloadedCard={preloadedCard}
          preloadedCourseSettings={preloadedCourseSettings}
          preloadedActiveCourse={preloadedActiveCourse}
        />
      </Authenticated>
    </>
  );
}

function LearnPageInner({
  preloadedCard,
  preloadedCourseSettings,
  preloadedActiveCourse,
}: {
  preloadedCard: Preloaded<typeof api.features.scheduling.getCardForReview>;
  preloadedCourseSettings: Preloaded<
    typeof api.features.courses.getActiveCourseSettings
  >;
  preloadedActiveCourse: Preloaded<typeof api.features.courses.getActiveCourse>;
}) {
  const router = useRouter();
  const goHome = () => router.push('/app');

  const state = useLearningMode({
    card: preloadedCard,
    courseSettings: preloadedCourseSettings,
    activeCourse: preloadedActiveCourse,
  });
  const { audio, openSettings } = useLearningAudio(state);

  const { threadId, isLoading: isThreadLoading } = useThread({
    autoCreate: true,
  });

  const chatPanel = threadId ? (
    <WrappedChatPanel threadId={threadId} />
  ) : isThreadLoading ? (
    <div className="flex-1 flex items-center justify-center">
      <Loader size={24} />
    </div>
  ) : null;

  const header = (
    <LearningHeader
      onBack={goHome}
      onSettingsOpen={openSettings}
    />
  );

  return (
    <LearningChatLayout header={header} chatPanel={chatPanel}>
      <LearningMode state={state} audio={audio} />
    </LearningChatLayout>
  );
}
