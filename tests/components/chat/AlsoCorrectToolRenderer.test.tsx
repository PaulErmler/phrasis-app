import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ToolUIPart } from 'ai';
import type { Id } from '@/convex/_generated/dataModel';
import type { ApprovalData } from '@/hooks/use-card-approvals';

// Stub the approval box: the renderer's job is deciding WHETHER to mount it
// (and with which props), not what it looks like — AlsoCorrectApproval has
// its own suite. The stub surfaces the forwarded props and exposes buttons
// so the handler plumbing (handleApprove → onAddAsNewCard, etc.) can be
// exercised end to end through the renderer.
vi.mock('@/components/chat/AlsoCorrectApproval', () => ({
  AlsoCorrectApproval: ({
    toolPart,
    approvalsByToolCallId,
    processingApprovals,
    onAddAsNewCard,
    onReplace,
    onReject,
  }: {
    toolPart: { toolCallId?: string };
    approvalsByToolCallId: Map<string, { _id: string }>;
    processingApprovals: Set<string>;
    onAddAsNewCard: (id: string) => void;
    onReplace: (id: string) => void;
    onReject: (id: string) => void;
  }) => (
    <div
      data-testid="also-correct-approval"
      data-tool-call-id={toolPart.toolCallId ?? ''}
      data-approval-ids={[...approvalsByToolCallId.keys()].join(',')}
      data-processing={[...processingApprovals].join(',')}
    >
      <button data-testid="stub-add" onClick={() => onAddAsNewCard('ap1')}>
        add
      </button>
      <button data-testid="stub-replace" onClick={() => onReplace('ap1')}>
        replace
      </button>
      <button data-testid="stub-reject" onClick={() => onReject('ap1')}>
        reject
      </button>
    </div>
  ),
}));

import { createAlsoCorrectToolRenderer } from '@/components/chat/tools/AlsoCorrectToolRenderer';

function makeToolPart(extra: Partial<Record<string, unknown>> = {}) {
  return {
    type: 'tool-markAlsoCorrect',
    toolCallId: 'tc-1',
    state: 'output-available',
    output: 'ok',
    input: { translations: [{ language: 'es', text: 'Hola.' }] },
    ...extra,
  } as unknown as ToolUIPart;
}

const handleApprove = vi.fn(async () => 'success' as const);
const handleReplace = vi.fn(async () => 'success' as const);
const handleReject = vi.fn(async () => 'success' as const);

function makeRenderer(
  overrides: Partial<Parameters<typeof createAlsoCorrectToolRenderer>[0]> = {},
) {
  const approvals = new Map<string, ApprovalData>([
    ['tc-1', { _id: 'ap1' } as unknown as ApprovalData],
  ]);
  return createAlsoCorrectToolRenderer({
    approvalsByToolCallId: approvals,
    processingApprovals: new Set<string>(['ap-busy']),
    handleApprove: handleApprove as unknown as (
      id: Id<'cardApprovals'>,
    ) => ReturnType<typeof handleApprove>,
    handleReplace: handleReplace as unknown as (
      id: Id<'cardApprovals'>,
    ) => ReturnType<typeof handleReplace>,
    handleReject: handleReject as unknown as (
      id: Id<'cardApprovals'>,
    ) => ReturnType<typeof handleReject>,
    isLoaded: true,
    ...overrides,
  });
}

beforeEach(() => {
  handleApprove.mockClear();
  handleReplace.mockClear();
  handleReject.mockClear();
});

describe('createAlsoCorrectToolRenderer', () => {
  it('returns null for tool parts that are not markAlsoCorrect', () => {
    const renderer = makeRenderer();
    const result = renderer(makeToolPart({ type: 'tool-createCard' }), 'm1', 0);
    expect(result).toBeNull();
  });

  it('renders an empty placeholder (no approval box) before approvals are loaded', () => {
    const renderer = makeRenderer({ isLoaded: false });
    const { container } = render(<>{renderer(makeToolPart(), 'm1', 0)}</>);
    // A bare <span> keeps the slot without flashing an unresolved box.
    expect(
      screen.queryByTestId('also-correct-approval'),
    ).not.toBeInTheDocument();
    expect(container.querySelector('span')).toBeInTheDocument();
    expect(container.textContent).toBe('');
  });

  it('mounts AlsoCorrectApproval with the tool part and approval state once loaded', () => {
    const renderer = makeRenderer();
    render(<>{renderer(makeToolPart(), 'm1', 0)}</>);

    const box = screen.getByTestId('also-correct-approval');
    expect(box.dataset.toolCallId).toBe('tc-1');
    expect(box.dataset.approvalIds).toBe('tc-1');
    expect(box.dataset.processing).toBe('ap-busy');
  });

  it('still mounts the approval box when the tool part has no toolCallId (fallback key path)', () => {
    const renderer = makeRenderer();
    render(<>{renderer(makeToolPart({ toolCallId: undefined }), 'm7', 3)}</>);
    expect(screen.getByTestId('also-correct-approval')).toBeInTheDocument();
  });

  it('wires handleApprove/handleReplace/handleReject to the approval callbacks', async () => {
    const user = userEvent.setup();
    const renderer = makeRenderer();
    render(<>{renderer(makeToolPart(), 'm1', 0)}</>);

    await user.click(screen.getByTestId('stub-add'));
    expect(handleApprove).toHaveBeenCalledWith('ap1');

    await user.click(screen.getByTestId('stub-replace'));
    expect(handleReplace).toHaveBeenCalledWith('ap1');

    await user.click(screen.getByTestId('stub-reject'));
    expect(handleReject).toHaveBeenCalledWith('ap1');
  });
});
