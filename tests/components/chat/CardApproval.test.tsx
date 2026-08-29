import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// CardApproval reads per-line proposal audio via convex/react (no provider in
// this jsdom render): useQuery → loading (undefined), useMutation → inert fn.
vi.mock('convex/react', () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(async () => ({ scheduled: false })),
  usePreloadedQuery: () => undefined,
}));
// The approval box reads the course's showIpa setting through the app-data
// context (useShowIpa, approvalCommon.tsx); these tests render it standalone.
vi.mock('@/components/app/AppDataProvider', () => ({
  useAppData: () => ({ preloadedCourseSettings: {} }),
}));
vi.mock('@/components/feature_tracking/useFeatureQuota', () => ({
  useFeatureQuota: () => ({ isAvailable: true, isLoading: false }),
}));
vi.mock('@/components/feature_tracking/FeatureBadge', () => ({
  FeatureBadge: () => null,
}));
vi.mock('@/components/autumn/paywall-dialog', () => ({ default: () => null }));
vi.mock('@/hooks/use-course-languages', () => ({
  useCourseLanguages: () => ({
    baseLanguages: ['en'],
    targetLanguages: ['es'],
  }),
}));
vi.mock('@/components/chat/EditApprovalDialog', () => ({
  EditApprovalDialog: ({
    open,
    approvalId,
  }: {
    open: boolean;
    approvalId: unknown;
  }) =>
    open ? (
      <div
        data-testid="edit-approval-dialog"
        data-approval-id={String(approvalId)}
      />
    ) : null,
}));

import { CardApproval } from '@/components/chat/CardApproval';
// The REAL string the server tool returns. Imported, not re-typed, so a
// server-side rewording fails here instead of silently rendering every
// successful call as an error box.
import { CREATE_CARD_SUCCESS } from '@/lib/types/tool-parts';

function makeToolPart(extra: Partial<any> = {}) {
  return {
    type: 'tool-createCard',
    toolCallId: 'tc-1',
    state: 'output-available',
    output: CREATE_CARD_SUCCESS,
    input: {
      translations: [
        { language: 'en', text: 'hello' },
        { language: 'es', text: 'hola' },
      ],
    },
    ...extra,
  } as any;
}

describe('CardApproval', () => {
  it('shows loading when approval is missing', () => {
    render(
      <CardApproval
        toolPart={makeToolPart({ state: 'input-available', output: undefined })}
        approvalsByToolCallId={new Map()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        processingApprovals={new Set()}
      />,
    );
    expect(screen.getByText('creatingApproval')).toBeInTheDocument();
  });

  it('shows approve/reject buttons in pending state', () => {
    const map = new Map();
    map.set('tc-1', {
      _id: 'ap1',
      toolCallId: 'tc-1',
      translations: [],
      status: 'pending',
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
    expect(screen.getByText('rejectButton')).toBeInTheDocument();
    expect(screen.getByText('approveButton')).toBeInTheDocument();
  });

  it('shows approved state', () => {
    const map = new Map();
    map.set('tc-1', {
      _id: 'ap1',
      toolCallId: 'tc-1',
      translations: [],
      status: 'approved',
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
    expect(screen.getByText('approved')).toBeInTheDocument();
  });

  it('calls onApprove when approve clicked', async () => {
    const user = userEvent.setup();
    const onApprove = vi.fn();
    const map = new Map();
    map.set('tc-1', {
      _id: 'ap1',
      toolCallId: 'tc-1',
      translations: [],
      status: 'pending',
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
    await user.click(screen.getByText('approveButton'));
    expect(onApprove).toHaveBeenCalledWith('ap1');
  });

  it('shows edit button in pending state and opens dialog', async () => {
    const user = userEvent.setup();
    const map = new Map();
    map.set('tc-1', {
      _id: 'ap1',
      toolCallId: 'tc-1',
      translations: [
        { language: 'en', text: 'hello' },
        { language: 'es', text: 'hola' },
      ],
      status: 'pending',
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
    const editButton = screen.getByTestId('card-edit');
    expect(editButton).toBeInTheDocument();
    expect(
      screen.queryByTestId('edit-approval-dialog'),
    ).not.toBeInTheDocument();
    await user.click(editButton);
    const dialog = screen.getByTestId('edit-approval-dialog');
    expect(dialog).toBeInTheDocument();
    expect(dialog.getAttribute('data-approval-id')).toBe('ap1');
  });

  it('hides edit button when approval is not pending', () => {
    const map = new Map();
    map.set('tc-1', {
      _id: 'ap1',
      toolCallId: 'tc-1',
      translations: [],
      status: 'approved',
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
    expect(screen.queryByTestId('card-edit')).not.toBeInTheDocument();
  });

  it('prefers approval.translations over tool input for display', () => {
    const map = new Map();
    map.set('tc-1', {
      _id: 'ap1',
      toolCallId: 'tc-1',
      translations: [
        { language: 'en', text: 'edited english' },
        { language: 'es', text: 'edited spanish' },
      ],
      status: 'pending',
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
    expect(screen.getByText('edited english')).toBeInTheDocument();
    expect(screen.getByText('edited spanish')).toBeInTheDocument();
    expect(screen.queryByText('hello')).not.toBeInTheDocument();
  });

  it('shows error alert on tool error', () => {
    render(
      <CardApproval
        toolPart={makeToolPart({ state: 'output-error', output: 'Err' })}
        approvalsByToolCallId={new Map()}
        onApprove={vi.fn()}
        onReject={vi.fn()}
        processingApprovals={new Set()}
      />,
    );
    expect(screen.getByText('failed')).toBeInTheDocument();
  });
});
