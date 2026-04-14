import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Textarea } from "@/components/ui/textarea";

describe("Textarea", () => {
  it("renders", () => {
    render(<Textarea aria-label="ta" placeholder="type" />);
    expect(screen.getByLabelText("ta")).toBeInTheDocument();
  });

  it("accepts typed input", async () => {
    const user = userEvent.setup();
    render(<Textarea aria-label="ta" />);
    const el = screen.getByLabelText("ta") as HTMLTextAreaElement;
    await user.type(el, "hi");
    expect(el.value).toBe("hi");
  });

  it("respects disabled", async () => {
    const user = userEvent.setup();
    render(<Textarea aria-label="ta" disabled defaultValue="" />);
    const el = screen.getByLabelText("ta") as HTMLTextAreaElement;
    await user.type(el, "no");
    expect(el.value).toBe("");
  });
});
