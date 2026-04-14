import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/i18n/locale", () => ({ setUserLocale: vi.fn() }));
vi.mock("next-themes", () => ({
  useTheme: () => ({ setTheme: vi.fn() }),
}));

import { LandingFooter } from "@/components/landing/landing-footer";

describe("LandingFooter", () => {
  it("renders brand name", () => {
    render(<LandingFooter />);
    // Brand name appears both in tests and in the image alt
    expect(screen.getAllByText("Flexling").length).toBeGreaterThan(0);
  });

  it("renders navigation/legal anchors", () => {
    render(<LandingFooter />);
    const impressumLinks = screen.getAllByText("legal.impressum");
    expect(impressumLinks.length).toBeGreaterThan(0);
  });
});
