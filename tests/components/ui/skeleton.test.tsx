import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "@/components/ui/skeleton";

describe("Skeleton", () => {
  it("renders with data-slot", () => {
    const { container } = render(<Skeleton className="h-10 w-10" />);
    const el = container.querySelector('[data-slot="skeleton"]');
    expect(el).toBeInTheDocument();
    expect(el?.className).toContain("animate-pulse");
  });

  it("merges custom className", () => {
    const { container } = render(<Skeleton className="custom" />);
    expect(container.querySelector(".custom")).toBeInTheDocument();
  });
});
