import type { UIMessage } from 'ai';

/**
 * Status of the chat submission/streaming process
 */
export type ChatStatus = 'submitted' | 'streaming' | 'ready' | 'error';

/**
 * Status of individual UI messages
 */
export type UIMessageStatus = 'streaming' | 'pending' | 'success' | 'failed';

/**
 * Extended UIMessage with agent-specific fields
 */
export type AgentUIMessage = UIMessage & {
  key: string;
  order: number;
  stepOrder: number;
  status: UIMessageStatus;
  text: string;
  _creationTime: number;
  agentName?: string;
};

/**
 * UIMessage with optional content field for compatibility
 */
export type ExtendedUIMessage = AgentUIMessage & {
  content?: string;
};

/**
 * Voice recording state
 */
export interface VoiceRecordingState {
  isRecording: boolean;
  isTranscribing: boolean;
}

/**
 * Thread data structure
 */
export interface Thread {
  _id: string;
  title?: string;
  summary?: string;
  userId?: string;
  status?: string;
  _creationTime: number;
}
