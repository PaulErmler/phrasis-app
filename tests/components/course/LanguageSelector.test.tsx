import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked }: { checked?: boolean }) => (
    <input type="checkbox" readOnly checked={!!checked} />
  ),
}));

import { LanguageSelector } from "@/components/course/LanguageSelector";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";

describe("LanguageSelector", () => {
  it("renders a row per supported language", () => {
    const { container } = render(
      <LanguageSelector
        selectedLanguages={[]}
        onToggleLanguage={() => {}}
      />,
    );
    const rows = container.querySelectorAll('[role="button"]');
    expect(rows.length).toBe(SUPPORTED_LANGUAGES.length);
  });

  it("calls onToggleLanguage on click", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { container } = render(
      <LanguageSelector
        selectedLanguages={[]}
        onToggleLanguage={onToggle}
      />,
    );
    const first = SUPPORTED_LANGUAGES[0];
    const rows = container.querySelectorAll('[role="button"]');
    await user.click(rows[0] as HTMLElement);
    expect(onToggle).toHaveBeenCalledWith(first.code);
  });

  it("filters out excluded languages", () => {
    const [a] = SUPPORTED_LANGUAGES;
    const { container } = render(
      <LanguageSelector
        selectedLanguages={[]}
        excludeLanguages={[a.code]}
        onToggleLanguage={() => {}}
      />,
    );
    const rows = container.querySelectorAll('[role="button"]');
    expect(rows.length).toBe(SUPPORTED_LANGUAGES.length - 1);
  });
});
