'use client';

import { useParams } from 'next/navigation';
import { ChatPageClient } from '@/components/app/ChatPageClient';

export default function ChatPage() {
  const { threadId } = useParams<{ threadId: string }>();
  return <ChatPageClient threadId={threadId} />;
}
