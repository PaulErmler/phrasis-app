import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Spinner } from "@/components/ui/spinner";

describe("Spinner", () => {
  it("exposes role=status and accessible label", () => {
    render(<Spinner />);
    const el = screen.getByRole("status");
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute("aria-label", "Loading");
  });
});
