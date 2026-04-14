import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/components/feature_tracking/useFeatureQuota", () => ({
  useFeatureQuota: () => ({ isAvailable: true, isLoading: false }),
}));
vi.mock("@/components/autumn/usage-limit-dialog", () => ({
  default: () => null,
}));

import { VoiceRecordButton } from "@/components/chat/VoiceRecordButton";

describe("VoiceRecordButton", () => {
  it("renders start label when idle", () => {
    render(
      <VoiceRecordButton
        isRecording={false}
        isTranscribing={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("startRecording")).toBeInTheDocument();
  });

  it("shows stop/recording when isRecording", () => {
    render(
      <VoiceRecordButton
        isRecording={true}
        isTranscribing={false}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText("stopRecording")).toBeInTheDocument();
    expect(screen.getByText("recording")).toBeInTheDocument();
  });

  it("is disabled while transcribing", () => {
    render(
      <VoiceRecordButton
        isRecording={false}
        isTranscribing={true}
        onClick={() => {}}
      />,
    );
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
  });

  it("fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <VoiceRecordButton
        isRecording={false}
        isTranscribing={false}
        onClick={onClick}
      />,
    );
    await user.click(screen.getByRole("button"));
    expect(onClick).toHaveBeenCalled();
  });
});
