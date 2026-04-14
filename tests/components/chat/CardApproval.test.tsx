import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/feature_tracking/useFeatureQuota", () => ({
  useFeatureQuota: () => ({ isAvailable: true, isLoading: false }),
}));
vi.mock("@/components/feature_tracking/FeatureBadge", () => ({
  FeatureBadge: () => null,
}));
vi.mock("@/components/autumn/paywall-dialog", () => ({ default: () => null }));
vi.mock("@/hooks/use-course-languages", () => ({
  useCourseLanguages: () => ({ targetLanguages: ["es"] }),
}));

import { CardApproval } from "@/components/chat/CardApproval";

function makeToolPart(extra: Partial<any> = {}) {
  return {
    type: "tool-createCard",
    toolCallId: "tc-1",
    state: "output-available",
    output: "Card has been created.",
    input: {
      translations: [
        { language: "en", text: "hello" },
        { language: "es", text: "hola" },
      ],
    },
    ...extra,
  } as any;
}

describe("CardApproval", () => {
  it("shows loading when approval is missing", () => {
    render(
      <CardApproval
        toolPart={makeToolPart({ state: "input-available", output: undefined })}
        approvalsByToolCallId={new Map()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        processingApprovals={new Set()}
      />,
    );
    expect(screen.getByText("creatingApproval")).toBeInTheDocument();
  });

  it("shows approve/reject buttons in pending state", () => {
    const map = new Map();
    map.set("tc-1", {
      _id: "ap1",
      toolCallId: "tc-1",
      translations: [],
      status: "pending",
    });
    render(
      <CardApproval
        toolPart={makeToolPart()}
        approvalsByToolCallId={map}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        processingApprovals={new Set()}
      />,
    );
    expect(screen.getByText("rejectButton")).toBeInTheDocument();
    expect(screen.getByText("approveButton")).toBeInTheDocument();
  });

  it("shows approved state", () => {
    const map = new Map();
    map.set("tc-1", {
      _id: "ap1",
      toolCallId: "tc-1",
      translations: [],
      status: "approved",
    });
    render(
      <CardApproval
        toolPart={makeToolPart()}
        approvalsByToolCallId={map}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        processingApprovals={new Set()}
      />,
    );
    expect(screen.getByText("approved")).toBeInTheDocument();
  });

  it("calls onApprove when approve clicked", async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const map = new Map();
    map.set("tc-1", {
      _id: "ap1",
      toolCallId: "tc-1",
      translations: [],
      status: "pending",
    });
    render(
      <CardApproval
        toolPart={makeToolPart()}
        approvalsByToolCallId={map}
        onApprove={onApprove}
        onReject={vi.fn()}
        processingApprovals={new Set()}
      />,
    );
    await user.click(screen.getByText("approveButton"));
    expect(onApprove).toHaveBeenCalledWith("ap1");
  });

  it("shows error alert on tool error", () => {
    render(
      <CardApproval
        toolPart={makeToolPart({ state: "output-error", output: "Err" })}
        approvalsByToolCallId={new Map()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        processingApprovals={new Set()}
      />,
    );
    expect(screen.getByText("failed")).toBeInTheDocument();
  });
});
