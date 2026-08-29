import type { ChatStatus } from '@/lib/types/chat';

/**
 * Chat status constants
 */
export const CHAT_STATUS = {
  SUBMITTED: 'submitted',
  STREAMING: 'streaming',
  READY: 'ready',
  ERROR: 'error',
} as const satisfies Record<string, ChatStatus>;
