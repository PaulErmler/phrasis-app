import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("motion/react", () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: any) => {
        const { children, ...rest } = props;
        const Tag = "div";
        return <Tag {...rest}>{children}</Tag>;
      },
    },
  ),
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={typeof href === "string" ? href : "#"} {...rest}>
      {children}
    </a>
  ),
}));

import { PricingSection } from "@/components/landing/pricing-section";

describe("PricingSection", () => {
  it("renders title", () => {
    render(<PricingSection />);
    expect(screen.getByText("title")).toBeInTheDocument();
  });

  it("renders three plans", () => {
    render(<PricingSection />);
    // Each plan has a CTA button with translation key `plans.<plan>.cta`
    expect(screen.getByText("plans.free.cta")).toBeInTheDocument();
    expect(screen.getByText("plans.basic.cta")).toBeInTheDocument();
    expect(screen.getByText("plans.pro.cta")).toBeInTheDocument();
  });

  it("renders traditional comparison section", () => {
    render(<PricingSection />);
    expect(screen.getByText("comparison.comparedWith")).toBeInTheDocument();
  });
});
