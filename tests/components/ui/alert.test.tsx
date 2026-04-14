import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";

describe("Alert", () => {
  it("renders with role=alert", () => {
    render(
      <Alert>
        <AlertTitle>Heads up</AlertTitle>
        <AlertDescription>Something happened</AlertDescription>
      </Alert>,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Heads up")).toBeInTheDocument();
    expect(screen.getByText("Something happened")).toBeInTheDocument();
  });

  it("applies destructive variant via data-slot", () => {
    const { container } = render(
      <Alert variant="destructive">
        <AlertTitle>Err</AlertTitle>
      </Alert>,
    );
    expect(container.querySelector('[data-slot="alert"]')).toBeInTheDocument();
  });
});
