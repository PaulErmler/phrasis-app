import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();
const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

import { GoToAppButton } from "@/components/home/go-to-app-button";

describe("GoToAppButton", () => {
  it("renders welcome-back card for authenticated users", () => {
    render(<GoToAppButton isAuthenticated={true} />);
    expect(screen.getByText("welcomeBack")).toBeInTheDocument();
    expect(screen.getByText("goToApp")).toBeInTheDocument();
  });

  it("renders sign-up card for unauthenticated users", () => {
    render(<GoToAppButton isAuthenticated={false} />);
    expect(screen.getByText("authCard.startLearning")).toBeInTheDocument();
  });

  it("navigates to /app when authenticated CTA clicked", async () => {
    const user = userEvent.setup();
    pushMock.mockClear();
    render(<GoToAppButton isAuthenticated={true} />);
    await user.click(screen.getByText("goToApp"));
    expect(pushMock).toHaveBeenCalledWith("/app");
  });

  it("navigates to sign-up for unauthenticated CTA", async () => {
    const user = userEvent.setup();
    pushMock.mockClear();
    render(<GoToAppButton isAuthenticated={false} />);
    await user.click(screen.getByText("getStarted"));
    expect(pushMock).toHaveBeenCalledWith("/auth/sign-up");
  });
});
