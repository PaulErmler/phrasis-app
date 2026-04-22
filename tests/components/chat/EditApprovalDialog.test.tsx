import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const updateMock = vi.fn();

vi.mock("convex/react", () => ({
  useMutation: () => updateMock,
}));
vi.mock("@/hooks/use-course-languages", () => ({
  useCourseLanguages: () => ({ baseLanguages: ["en"], targetLanguages: ["es"] }),
}));
vi.mock("@/lib/languages", () => ({
  getLocalizedLanguageNameByCode: (code: string) => code.toUpperCase(),
}));

import { EditApprovalDialog } from "@/components/chat/EditApprovalDialog";

const translations = [
  { language: "en", text: "Hello" },
  { language: "es", text: "Hola" },
];

function renderDialog(overrides: Partial<Parameters<typeof EditApprovalDialog>[0]> = {}) {
  const onOpenChange = vi.fn();
  render(
    <EditApprovalDialog
      open={true}
      onOpenChange={onOpenChange}
      approvalId={"ap1" as unknown as Parameters<typeof EditApprovalDialog>[0]["approvalId"]}
      translations={translations}
      {...overrides}
    />,
  );
  return { onOpenChange };
}

describe("EditApprovalDialog", () => {
  it("renders one input per language, base before target", () => {
    renderDialog();
    const en = screen.getByLabelText("EN") as HTMLInputElement;
    const es = screen.getByLabelText("ES") as HTMLInputElement;
    expect(en.value).toBe("Hello");
    expect(es.value).toBe("Hola");
  });

  it("disables Save when there are no changes", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
  });

  it("enables Save after edit and calls mutation on click", async () => {
    updateMock.mockReset();
    updateMock.mockResolvedValue({ success: true });
    const user = userEvent.setup();
    const { onOpenChange } = renderDialog();
    const en = screen.getByLabelText("EN");
    await user.clear(en);
    await user.type(en, "Hi");
    const save = screen.getByRole("button", { name: "save" });
    expect(save).toBeEnabled();
    await user.click(save);
    expect(updateMock).toHaveBeenCalledWith({
      approvalId: "ap1",
      translations: [
        { language: "en", text: "Hi" },
        { language: "es", text: "Hola" },
      ],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables Save when any field is empty", async () => {
    const user = userEvent.setup();
    renderDialog();
    const en = screen.getByLabelText("EN");
    await user.clear(en);
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
  });

  it("preserves user edits when translations prop updates while open", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <EditApprovalDialog
        open={true}
        onOpenChange={onOpenChange}
        approvalId={"ap1" as unknown as Parameters<typeof EditApprovalDialog>[0]["approvalId"]}
        translations={translations}
      />,
    );
    const en = screen.getByLabelText("EN") as HTMLInputElement;
    await user.clear(en);
    await user.type(en, "Hi");
    expect(en.value).toBe("Hi");

    // Simulate Convex reactivity: same content, new array reference.
    act(() => {
      rerender(
        <EditApprovalDialog
          open={true}
          onOpenChange={onOpenChange}
          approvalId={"ap1" as unknown as Parameters<typeof EditApprovalDialog>[0]["approvalId"]}
          translations={translations.map((t) => ({ ...t }))}
        />,
      );
    });

    expect((screen.getByLabelText("EN") as HTMLInputElement).value).toBe("Hi");
    expect(screen.getByRole("button", { name: "save" })).toBeEnabled();
  });

  it("disables Save when any field exceeds MAX_CARD_TEXT_LENGTH", async () => {
    const user = userEvent.setup();
    renderDialog();
    const en = screen.getByLabelText("EN");
    await user.clear(en);
    await user.click(en);
    // Paste to avoid typing 151 characters one by one
    await user.paste("a".repeat(151));
    expect(screen.getByRole("button", { name: "save" })).toBeDisabled();
  });
});
