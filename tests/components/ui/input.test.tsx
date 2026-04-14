import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "@/components/ui/input";

describe("Input", () => {
  it("renders", () => {
    render(<Input placeholder="Email" />);
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
  });

  it("accepts typing", async () => {
    const user = userEvent.setup();
    render(<Input aria-label="x" />);
    const el = screen.getByLabelText("x") as HTMLInputElement;
    await user.type(el, "abc");
    expect(el.value).toBe("abc");
  });

  it("forwards type attribute", () => {
    render(<Input type="password" aria-label="pw" />);
    expect(screen.getByLabelText("pw")).toHaveAttribute("type", "password");
  });

  it("respects disabled", async () => {
    const user = userEvent.setup();
    render(<Input disabled aria-label="y" defaultValue="" />);
    const el = screen.getByLabelText("y") as HTMLInputElement;
    await user.type(el, "zzz");
    expect(el.value).toBe("");
  });
});
