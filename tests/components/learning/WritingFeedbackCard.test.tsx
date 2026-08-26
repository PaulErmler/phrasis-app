import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/components/autumn/usage-limit-dialog', () => ({
  default: () => <div data-testid="usage-limit-dialog" />,
}));

import {
  WritingFeedbackCard,
  type RowFeedback,
} from '@/components/app/learning/WritingFeedbackCard';

// next-intl is stubbed in tests/setup.ts to return raw keys.

describe('WritingFeedbackCard', () => {
  it('renders a skeleton while pending', () => {
    render(<WritingFeedbackCard feedback={{ status: 'pending' }} />);
    expect(screen.getByTestId('writing-feedback-pending')).toBeInTheDocument();
  });

  it('renders nothing for an errored grade', () => {
    const { container } = render(
      <WritingFeedbackCard feedback={{ status: 'error' }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a correct answer — the green diff already says it', () => {
    const { container } = render(
      <WritingFeedbackCard
        feedback={{
          status: 'done',
          result: { verdict: 'correct', matched: 'alternative' },
        }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders verdict, typed notes, the saved-alternative line, and discuss', async () => {
    const onDiscuss = vi.fn();
    const feedback: RowFeedback = {
      status: 'done',
      result: {
        verdict: 'alsoCorrect',
        corrected: 'Me gustaría un café, por favor.',
        notes: [{ type: 'register', text: 'Both are polite requests.' }],
        savedAlternative: true,
      },
    };
    render(<WritingFeedbackCard feedback={feedback} onDiscuss={onDiscuss} />);
    expect(screen.getByText('verdict.alsoCorrect')).toBeInTheDocument();
    expect(screen.getByText('noteType.register')).toBeInTheDocument();
    expect(screen.getByText(/Both are polite requests\./)).toBeInTheDocument();
    // Stored automatically — the line just confirms it.
    expect(
      screen.getByTestId('writing-feedback-alternative-saved'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('writing-feedback-discuss'));
    expect(onDiscuss).toHaveBeenCalledTimes(1);
  });

  it('offers the make-default prompt on alsoCorrect and reports success', async () => {
    const onMakeDefault = vi.fn().mockResolvedValue(undefined);
    const feedback: RowFeedback = {
      status: 'done',
      result: {
        verdict: 'alsoCorrect',
        corrected: 'Me gustaría un café.',
        notes: [{ type: 'register', text: 'Same meaning, slightly softer.' }],
        savedAlternative: true,
      },
    };
    render(
      <WritingFeedbackCard feedback={feedback} onMakeDefault={onMakeDefault} />,
    );
    await userEvent.click(
      screen.getByTestId('writing-feedback-make-default-confirm'),
    );
    expect(onMakeDefault).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId('writing-feedback-make-default-done'),
    ).toBeInTheDocument();
    // Button gone after success; a second click can't double-edit.
    expect(
      screen.queryByTestId('writing-feedback-make-default-confirm'),
    ).not.toBeInTheDocument();
  });

  it('resets the make-default button to idle when the edit rejects', async () => {
    // The caller surfaces the error (toast or paywall); this card only
    // resets its prompt so a later attempt (e.g. post-upgrade) still works.
    const onMakeDefault = vi.fn().mockRejectedValue(new Error('USAGE_LIMIT'));
    const feedback: RowFeedback = {
      status: 'done',
      result: {
        verdict: 'alsoCorrect',
        corrected: 'Me gustaría un café.',
        notes: [{ type: 'register', text: 'Same meaning, slightly softer.' }],
        savedAlternative: true,
      },
    };
    render(
      <WritingFeedbackCard feedback={feedback} onMakeDefault={onMakeDefault} />,
    );
    await userEvent.click(
      screen.getByTestId('writing-feedback-make-default-confirm'),
    );
    const button = screen.getByTestId('writing-feedback-make-default-confirm');
    expect(button).toBeEnabled();
    expect(
      screen.queryByTestId('writing-feedback-make-default-done'),
    ).not.toBeInTheDocument();
  });

  it('hides the make-default button for non-alsoCorrect verdicts', () => {
    const onMakeDefault = vi.fn();
    const wrong: RowFeedback = {
      status: 'done',
      result: {
        verdict: 'wrong',
        corrected: 'X.',
        notes: [],
        savedAlternative: false,
      },
    };
    render(
      <WritingFeedbackCard feedback={wrong} onMakeDefault={onMakeDefault} />,
    );
    expect(
      screen.queryByTestId('writing-feedback-make-default-confirm'),
    ).not.toBeInTheDocument();
  });

  it('caps rendering at the provided notes and shows the wrong verdict', () => {
    const feedback: RowFeedback = {
      status: 'done',
      result: {
        verdict: 'wrong',
        corrected: 'Quisiera un café, por favor.',
        notes: [
          { type: 'vocab', text: 'nada means nothing.' },
          { type: 'grammar', text: 'A request needs a verb.' },
        ],
        savedAlternative: false,
      },
    };
    render(<WritingFeedbackCard feedback={feedback} />);
    expect(screen.getByText('verdict.wrong')).toBeInTheDocument();
    expect(screen.getAllByText(/noteType\./)).toHaveLength(2);
    expect(
      screen.queryByTestId('writing-feedback-alternative-saved'),
    ).not.toBeInTheDocument();
  });

  it('renders the limit line with upgrade and turn-off actions', async () => {
    const onTurnOff = vi.fn();
    render(
      <WritingFeedbackCard
        feedback={{ status: 'limit' }}
        onTurnOff={onTurnOff}
      />,
    );
    expect(screen.getByText('limitReached')).toBeInTheDocument();
    expect(screen.getByTestId('writing-feedback-upgrade')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('writing-feedback-turn-off'));
    expect(onTurnOff).toHaveBeenCalledTimes(1);
  });

  it('omits the turn-off button when no handler is provided', () => {
    render(<WritingFeedbackCard feedback={{ status: 'limit' }} />);
    expect(
      screen.queryByTestId('writing-feedback-turn-off'),
    ).not.toBeInTheDocument();
  });
});
