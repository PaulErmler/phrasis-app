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

/**
 * Error messages
 */
export const ERROR_MESSAGES = {
  CHAT_NOT_INITIALIZED: 'Chat not initialized',
  FAILED_TO_SEND: 'Failed to send message',
  FAILED_TO_CREATE_THREAD: 'Failed to create new conversation',
  FAILED_TO_INITIALIZE: 'Failed to initialize chat',
  FAILED_TO_TRANSCRIBE: 'Failed to transcribe audio',
  MICROPHONE_ACCESS: 'Failed to access microphone',
} as const;

/**
 * Success messages
 */
export const SUCCESS_MESSAGES = {
  VOICE_TRANSCRIBED: 'Voice input transcribed',
  FILES_ATTACHED: 'Files attached',
} as const;
