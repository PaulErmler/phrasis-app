import { describe, it, expect, vi, beforeAll } from "vitest";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";

// cmdk uses ResizeObserver and Element.scrollIntoView; jsdom ships neither.
// Polyfill before any component renders so the Command palette can mount.
beforeAll(() => {
  if (typeof globalThis.ResizeObserver === "undefined") {
    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (globalThis as any).ResizeObserver = StubResizeObserver;
  }
  if (
    typeof window !== "undefined" &&
    !(Element.prototype as unknown as { scrollIntoView?: unknown })
      .scrollIntoView
  ) {
    (Element.prototype as any).scrollIntoView = function () {};
  }
});

vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: ({ checked }: { checked?: boolean }) => (
    <input type="checkbox" readOnly checked={!!checked} />
  ),
}));

import { LanguageSelector } from "@/components/course/LanguageSelector";
import { SUPPORTED_LANGUAGES } from "@/lib/languages";

const messages = {
  LanguageSelector: {
    searchPlaceholder: "Search languages…",
    noResults: "No languages match.",
    categories: {
      germanic: "Germanic & Nordic",
      romance: "Romance",
      slavic: "Slavic",
      baltic: "Baltic",
      "asian-east": "East Asian",
      "asian-southeast": "Southeast Asian",
      "south-asian": "South Asian",
      semitic: "Semitic & Middle Eastern",
      african: "African",
      other: "Other",
    },
  },
};

function renderSelector(
  props: Partial<React.ComponentProps<typeof LanguageSelector>> = {},
) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <LanguageSelector
        selectedLanguages={[]}
        onToggleLanguage={() => {}}
        {...props}
      />
    </NextIntlClientProvider>,
  );
}

// The selector hides any language with `hiddenFromPicker: true` (currently
// the English sub-variants), so the rendered row count compares against the
// picker-visible subset, not the full SUPPORTED_LANGUAGES list.
const PICKER_LANGUAGES = SUPPORTED_LANGUAGES.filter((l) => !l.hiddenFromPicker);

describe("LanguageSelector", () => {
  it("renders one CommandItem per picker-visible language", () => {
    const { container } = renderSelector();
    // cmdk uses role="option" for items.
    const rows = container.querySelectorAll('[cmdk-item=""]');
    expect(rows.length).toBe(PICKER_LANGUAGES.length);
  });

  it("calls onToggleLanguage with the matching code when an item is clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const { getByText } = renderSelector({ onToggleLanguage: onToggle });
    // Pick French by its native name "Français" — unique across rows (the
    // English variants all share the word "English"). Specific assertion
    // catches "wrong code emitted" bugs the previous "any code" check missed.
    await user.click(getByText("Français"));
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledWith("fr");
  });

  it("filters out excluded languages", () => {
    const [a] = PICKER_LANGUAGES;
    const { container } = renderSelector({ excludeLanguages: [a.code] });
    const rows = container.querySelectorAll('[cmdk-item=""]');
    expect(rows.length).toBe(PICKER_LANGUAGES.length - 1);
  });
});
