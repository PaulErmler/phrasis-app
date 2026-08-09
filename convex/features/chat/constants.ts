/**
 * Max user messages (excluding tool responses) allowed per thread.
 * Shared between backend (Convex) and frontend (Next.js).
 *
 * Counted against a single 300-item page in `sendMessage`; a quick action
 * stores one extra (hidden) system message per use, so keep the page size
 * comfortably above the worst-case stored-message count per thread.
 */
export const THREAD_MESSAGE_LIMIT = 20;

/**
 * Max characters allowed in a single chat message.
 * Shared between backend (Convex) and frontend (Next.js).
 */
export const MAX_MESSAGE_LENGTH = 2000;
