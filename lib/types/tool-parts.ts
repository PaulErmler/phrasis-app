import type { ToolUIPart } from 'ai';

/**
 * Input shape for the createCard tool
 */
export interface CreateCardInput {
  languages: string[];
  translations: string[];
  mainLanguage: string;
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
