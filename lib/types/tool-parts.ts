import type { ToolUIPart } from 'ai';

/**
 * The card tools' exact result strings. The approval renderers classify a
 * finished tool call by comparing its output against these, so they live in
 * this client-safe module — imported by BOTH the tool handlers
 * (convex/features/chat/agent.ts) and the approval boxes — instead of being
 * mirrored as per-file literals that could silently drift (a server-side
 * rewording would then render every success as an error box).
 */
export const CREATE_CARD_SUCCESS = 'Card has been created.';
export const MARK_ALSO_CORRECT_SUCCESS =
  'Marked as also correct. The user has been offered to save it.';
/**
 * The user's version already matches the card verbatim — a SUCCESS outcome
 * with nothing to offer, not a failure. Distinct from the string above so the
 * renderer draws no approval box (and, critically, no error box) while the
 * model's own prose still confirms the answer was right.
 */
export const MARK_ALSO_CORRECT_NOOP =
  "That is exactly the card's own wording, so there is nothing to save. Confirm to the user that their answer was correct.";

/**
 * Input shape for the createCard tool
 */
export interface CreateCardInput {
  translations: { language: string; text: string }[];
}

/**
 * Specific type for createCard tool parts.
 * Input may be undefined during streaming until it's fully populated.
 * toolCallId exists at runtime but is not in the base ToolUIPart type.
 */
export interface CreateCardToolPart {
  type: 'tool-createCard';
  input?: CreateCardInput;
  toolCallId?: string;
}

/**
 * Type guard to check if a tool part is a createCard tool.
 * Only checks the type name — `input` can be undefined for error/streaming
 * states, which `CardApproval` handles gracefully.
 */
export function isCreateCardToolPart(
  toolPart: ToolUIPart,
): toolPart is CreateCardToolPart & ToolUIPart {
  return toolPart.type === 'tool-createCard';
}

/**
 * Input shape for the markAlsoCorrect tool. `translations` carries only the
 * languages the model changed; the approval row stores the full merged set.
 */
export interface MarkAlsoCorrectInput {
  translations: { language: string; text: string }[];
  metadata?: {
    speakerGender?: string;
    register?: string;
    addresseeGender?: string;
    addresseeNumber?: string;
    addressesSomeone?: boolean;
  };
}

/**
 * Specific type for markAlsoCorrect tool parts.
 * Input may be undefined during streaming until it's fully populated.
 */
export interface MarkAlsoCorrectToolPart {
  type: 'tool-markAlsoCorrect';
  input?: MarkAlsoCorrectInput;
  toolCallId?: string;
}

/**
 * Type guard to check if a tool part is a markAlsoCorrect tool.
 * Only checks the type name — `input` can be undefined for error/streaming
 * states, which `AlsoCorrectApproval` handles gracefully.
 */
export function isMarkAlsoCorrectToolPart(
  toolPart: ToolUIPart,
): toolPart is MarkAlsoCorrectToolPart & ToolUIPart {
  return toolPart.type === 'tool-markAlsoCorrect';
}

/**
 * Type guard to check if a tool part has a toolCallId
 */
export function hasToolCallId(toolPart: ToolUIPart): boolean {
  return 'toolCallId' in toolPart && typeof toolPart.toolCallId === 'string';
}

/**
 * Safely extract toolCallId from a tool part
 */
export function getToolCallId(toolPart: ToolUIPart): string | undefined {
  if (hasToolCallId(toolPart)) {
    return toolPart.toolCallId as string;
  }
  return undefined;
}
