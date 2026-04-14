import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("convex/react", () => ({
  Authenticated: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@daveyplate/better-auth-ui", () => ({
  UserButton: () => <button aria-label="User">U</button>,
}));

import { ChatHeader } from "@/components/chat/ChatHeader";

describe("ChatHeader", () => {
  it("renders Flexling brand", () => {
    render(<ChatHeader />);
    expect(screen.getByText("Flexling")).toBeInTheDocument();
  });

  it("omits back button when onBack not given", () => {
    render(<ChatHeader />);
    // UserButton present; one button total
    expect(screen.getAllByRole("button").length).toBe(1);
  });

  it("calls onBack when back button clicked", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<ChatHeader onBack={onBack} />);
    // first button is the back button
    const buttons = screen.getAllByRole("button");
    await user.click(buttons[0]);
    expect(onBack).toHaveBeenCalled();
  });
});
