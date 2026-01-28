import type { ToolUIPart } from "ai";

/**
 * Input shape for the createFlashcard tool
 */
export interface CreateFlashcardInput {
  text: string;
  note: string;
}

/**
 * Specific type for createFlashcard tool parts
 * Note: input may be undefined during streaming until it's fully populated
 * Note: toolCallId exists at runtime but is not in the base ToolUIPart type
 */
export interface CreateFlashcardToolPart {
  type: "tool-createFlashcard";
  input?: CreateFlashcardInput;
  toolCallId?: string;
}

/**
 * Type guard to check if a tool part is a createFlashcard tool
 * Also validates that the input field exists (may not be populated during streaming)
 */
export function isCreateFlashcardToolPart(
  toolPart: ToolUIPart
): toolPart is CreateFlashcardToolPart & ToolUIPart {
  return (
    toolPart.type === "tool-createFlashcard" &&
    typeof toolPart.input === "object" &&
    toolPart.input !== null
  );
}

/**
 * Type guard to check if a tool part has a toolCallId
 */
export function hasToolCallId(toolPart: ToolUIPart): boolean {
  return "toolCallId" in toolPart && typeof toolPart.toolCallId === "string";
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

