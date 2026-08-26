import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// Same jsdom harness as CardApproval.test.tsx: per-line proposal audio reads
// convex/react (no provider here), quota is available unless a test overrides.
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(async () => ({ scheduled: false })),
  usePreloadedQuery: () => undefined,
}));
// The approval box reads the course's showIpa setting through the app-data
// context (useShowIpa, approvalCommon.tsx); these tests render it standalone.
vi.mock("@/components/app/AppDataProvider", () => ({
  useAppData: () => ({ preloadedCourseSettings: {} }),
}));
const quotaAvailable = { custom_sentences: true, card_edits: true };
vi.mock("@/components/feature_tracking/useFeatureQuota", () => ({
  useFeatureQuota: (featureId: "custom_sentences" | "card_edits") => ({
    isAvailable: quotaAvailable[featureId],
    isLoading: false,
  }),
}));
vi.mock("@/components/feature_tracking/FeatureBadge", () => ({
  FeatureBadge: () => null,
}));
vi.mock("@/components/autumn/paywall-dialog", () => ({
  default: ({ open, featureId }: { open: boolean; featureId: string }) =>
    open ? <div data-testid="paywall" data-feature={featureId} /> : null,
}));
vi.mock("@/hooks/use-course-languages", () => ({
  useCourseLanguages: () => ({ baseLanguages: ["en"], targetLanguages: ["es"] }),
}));

import { AlsoCorrectApproval } from "@/components/chat/AlsoCorrectApproval";
// The REAL result strings the server tool returns. Importing them (rather than
// re-typing the literals) is what makes this suite fail if the two sides ever
// drift. The failure mode being pinned is silent: a reworded success string
// classifies every successful call as an error.
import {
  MARK_ALSO_CORRECT_NOOP,
  MARK_ALSO_CORRECT_SUCCESS,
} from "@/lib/types/tool-parts";

function makeToolPart(extra: Partial<any> = {}) {
  return {
    type: "tool-markAlsoCorrect",
    toolCallId: "tc-1",
    state: "output-available",
    output: MARK_ALSO_CORRECT_SUCCESS,
    input: { translations: [{ language: "es", text: "Quisiera un café." }] },
    ...extra,
  } as any;
}

function approvalMap(extra: Partial<any> = {}) {
  const map = new Map();
  map.set("tc-1", {
    _id: "ap1",
    toolCallId: "tc-1",
    kind: "alsoCorrect",
    cardId: "card_1",
    status: "pending",
    translations: [
      { language: "en", text: "I would like a coffee." },
      { language: "es", text: "Quisiera un café." },
    ],
    changedLanguages: ["es"],
    ...extra,
  });
  return map;
}

function renderBox(props: Partial<any> = {}) {
  const handlers = {
    onAddAsNewCard: vi.fn(async () => "success" as const),
    onReplace: vi.fn(async () => "success" as const),
    onReject: vi.fn(async () => "success" as const),
  };
  render(
    <AlsoCorrectApproval
      toolPart={makeToolPart()}
      approvalsByToolCallId={approvalMap()}
      processingApprovals={new Set()}
      {...handlers}
      {...props}
    />,
  );
  return handlers;
}

describe("AlsoCorrectApproval", () => {
  it("renders the proposal with all three actions while pending", () => {
    renderBox();
    expect(screen.getByTestId("also-correct-approval")).toBeInTheDocument();
    expect(screen.getByTestId("also-correct-add")).toBeInTheDocument();
    expect(screen.getByTestId("also-correct-replace")).toBeInTheDocument();
    expect(screen.getByTestId("also-correct-dismiss")).toBeInTheDocument();
    // The changed language and the card's untouched one both render.
    expect(screen.getByText("Quisiera un café.")).toBeInTheDocument();
    expect(screen.getByText("I would like a coffee.")).toBeInTheDocument();
  });

  describe("tool-result classification (server↔client string contract)", () => {
    it("renders NOTHING for the no-op result, not an error, not a spinner", () => {
      renderBox({
        toolPart: makeToolPart({ output: MARK_ALSO_CORRECT_NOOP }),
        approvalsByToolCallId: new Map(),
      });
      expect(screen.queryByTestId("also-correct-approval")).not.toBeInTheDocument();
      expect(screen.queryByText("failed")).not.toBeInTheDocument();
      expect(screen.queryByText("loading")).not.toBeInTheDocument();
    });

    it("treats the exact success string as success (an unrecognized output is an error)", () => {
      const { unmount } = render(
        <AlsoCorrectApproval
          toolPart={makeToolPart()}
          approvalsByToolCallId={approvalMap()}
          onAddAsNewCard={vi.fn()}
          onReplace={vi.fn()}
          onReject={vi.fn()}
          processingApprovals={new Set()}
        />,
      );
      expect(screen.queryByText("failed")).not.toBeInTheDocument();
      unmount();

      // Any other completed output (e.g. a reworded server string) is an error.
      renderBox({
        toolPart: makeToolPart({ output: "Marked as also correct." }),
      });
      expect(screen.getByText("failed")).toBeInTheDocument();
    });

    it("shows the error alert on a tool error", () => {
      renderBox({
        toolPart: makeToolPart({ state: "output-error", output: "boom" }),
      });
      expect(screen.getByText("failed")).toBeInTheDocument();
    });

    it("shows the streaming skeleton before the tool completes", () => {
      renderBox({
        toolPart: makeToolPart({ state: "input-available", output: undefined }),
        approvalsByToolCallId: new Map(),
      });
      expect(screen.getByText("loading")).toBeInTheDocument();
    });
  });

  describe("actions", () => {
    it.each([
      ["also-correct-replace", "onReplace"],
      ["also-correct-add", "onAddAsNewCard"],
      ["also-correct-dismiss", "onReject"],
    ] as const)("%s passes the approval id to %s", async (testId, handler) => {
      const user = userEvent.setup();
      const handlers = renderBox();
      await user.click(screen.getByTestId(testId));
      expect(handlers[handler]).toHaveBeenCalledWith("ap1");
    });

    it("flips to the resolved label optimistically on success", async () => {
      const user = userEvent.setup();
      renderBox();
      await user.click(screen.getByTestId("also-correct-replace"));
      await waitFor(() =>
        expect(screen.getByTestId("also-correct-resolved")).toHaveTextContent(
          "savedAsAlternative",
        ),
      );
    });

    it("rolls the label back when the target card is already gone", async () => {
      const user = userEvent.setup();
      renderBox({ onReplace: vi.fn(async () => "card_replaced" as const) });
      await user.click(screen.getByTestId("also-correct-replace"));
      // Still actionable, never a green "updated" for a write that failed.
      await waitFor(() =>
        expect(screen.getByTestId("also-correct-replace")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("also-correct-resolved")).not.toBeInTheDocument();
      expect(screen.queryByTestId("paywall")).not.toBeInTheDocument();
    });

    it("rolls back without a paywall on usage_limit (saving an alternative is free)", async () => {
      const user = userEvent.setup();
      renderBox({ onReplace: vi.fn(async () => "usage_limit" as const) });
      await user.click(screen.getByTestId("also-correct-replace"));
      await waitFor(() =>
        expect(screen.getByTestId("also-correct-replace")).toBeInTheDocument(),
      );
      expect(screen.queryByTestId("also-correct-resolved")).not.toBeInTheDocument();
      expect(screen.queryByTestId("paywall")).not.toBeInTheDocument();
    });

    it("with the quota already exhausted, the click paywalls instead of calling the mutation", async () => {
      const user = userEvent.setup();
      quotaAvailable.custom_sentences = false;
      try {
        const handlers = renderBox();
        await user.click(screen.getByTestId("also-correct-add"));
        expect(handlers.onAddAsNewCard).not.toHaveBeenCalled();
        expect(screen.getByTestId("paywall")).toHaveAttribute(
          "data-feature",
          "custom_sentences",
        );
      } finally {
        quotaAvailable.custom_sentences = true;
      }
    });
  });

  describe("resolved and replace-only states", () => {
    it("hides add-as-new-card on a replace-only proposal (a blank card line)", () => {
      renderBox({ approvalsByToolCallId: approvalMap({ replaceOnly: true }) });
      expect(screen.getByTestId("also-correct-replace")).toBeInTheDocument();
      expect(screen.queryByTestId("also-correct-add")).not.toBeInTheDocument();
    });

    it("renders a server-resolved row as resolved, per its resolution", () => {
      renderBox({
        approvalsByToolCallId: approvalMap({
          status: "approved",
          resolution: "newCard",
        }),
      });
      expect(screen.getByTestId("also-correct-resolved")).toHaveTextContent(
        "added",
      );
      expect(screen.queryByTestId("also-correct-replace")).not.toBeInTheDocument();
    });

    it("renders a rejected row as dismissed", () => {
      renderBox({ approvalsByToolCallId: approvalMap({ status: "rejected" }) });
      expect(screen.getByTestId("also-correct-resolved")).toHaveTextContent(
        "dismissed",
      );
    });

    it("disables the actions while the approval is processing", () => {
      renderBox({ processingApprovals: new Set(["ap1"]) });
      expect(screen.getByTestId("also-correct-replace")).toBeDisabled();
      expect(screen.getByTestId("also-correct-add")).toBeDisabled();
      expect(screen.getByTestId("also-correct-dismiss")).toBeDisabled();
    });
  });
});
