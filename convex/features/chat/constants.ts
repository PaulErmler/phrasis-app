/**
 * Max user messages (excluding tool responses) allowed per thread.
 * Shared between backend (Convex) and frontend (Next.js).
 *
 * `sendMessage` counts across ALL of the thread's pages. Tool-call-heavy
 * turns can store a dozen-plus assistant/tool messages each, so any
 * single-page count would freeze once the thread outgrows the page.
 */
export const THREAD_MESSAGE_LIMIT = 15;

/**
 * Max characters allowed in a single chat message.
 * Shared between backend (Convex) and frontend (Next.js).
 */
export const MAX_MESSAGE_LENGTH = 2000;
