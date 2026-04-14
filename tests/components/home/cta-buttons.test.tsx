import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));
vi.mock("@khmyznikov/pwa-install", () => ({}));

import { CTAButtons } from "@/components/home/cta-buttons";

describe("CTAButtons", () => {
  it("shows goToApp for authenticated users", async () => {
    const user = userEvent.setup();
    pushMock.mockClear();
    render(<CTAButtons isAuthenticated={true} />);
    expect(screen.getByText("goToApp")).toBeInTheDocument();
    await user.click(screen.getByText("goToApp"));
    expect(pushMock).toHaveBeenCalledWith("/app");
  });

  it("shows sign in/up for unauthenticated users", () => {
    render(<CTAButtons isAuthenticated={false} />);
    expect(screen.getByText("signIn")).toBeInTheDocument();
    expect(screen.getByText("getStarted")).toBeInTheDocument();
    expect(screen.getByText("installApp")).toBeInTheDocument();
  });
});
