import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AnnotationLines } from '@/components/app/learning/AnnotationLines';

/**
 * The word mapping. The lines THEMSELVES are the control: tapping them swaps
 * them for the per-word columns and tapping again swaps back. Three rules
 * carry it — they are only tappable where the lines can actually be paired
 * with the words, the mapping REPLACES the lines rather than repeating them,
 * and it never shows a line the learner has switched off.
 */

const RU = {
  text: 'Мне нравится гулять',
  language: 'ru',
  romanization: 'mne nravitsya gulyat',
  hyperliteral: 'To-me pleases to-walk',
};

describe('AnnotationLines: word mapping', () => {
  it('makes the lines tappable when they pair with the words', () => {
    render(<AnnotationLines {...RU} showRomanization showHyperliteral />);
    expect(screen.getByTestId('word-mapping-toggle')).toBeInTheDocument();
  });

  it('is not tappable while the row is blurred, so a tap still reveals', () => {
    render(
      <AnnotationLines
        {...RU}
        showRomanization
        showHyperliteral
        interactive={false}
      />,
    );
    expect(screen.queryByTestId('word-mapping-toggle')).toBeNull();
    expect(screen.getByTestId('hyperliteral-line')).toBeInTheDocument();
  });

  it('is not offered without the sentence and its language', () => {
    render(
      <AnnotationLines
        romanization={RU.romanization}
        hyperliteral={RU.hyperliteral}
        showRomanization
        showHyperliteral
      />,
    );
    expect(screen.queryByTestId('word-mapping-toggle')).toBeNull();
  });

  it('is not offered when no line pairs with the words', () => {
    render(
      <AnnotationLines
        {...RU}
        hyperliteral="To-me pleases"
        romanization={undefined}
        showHyperliteral
      />,
    );
    expect(screen.queryByTestId('word-mapping-toggle')).toBeNull();
  });

  it('starts on the flat lines and switches to one column per word', async () => {
    const user = userEvent.setup();
    render(<AnnotationLines {...RU} showRomanization showHyperliteral />);
    expect(screen.queryByTestId('interlinear-stack')).toBeNull();

    await user.click(screen.getByTestId('word-mapping-toggle'));
    const stack = screen.getByTestId('interlinear-stack');
    expect(stack.children).toHaveLength(3);
    expect(stack.children[0]).toHaveTextContent('Мне');
    expect(stack.children[0]).toHaveTextContent('mne');
    expect(stack.children[0]).toHaveTextContent('To-me');
  });

  it('REPLACES the flat lines, so an annotation is never on screen twice', async () => {
    const user = userEvent.setup();
    render(<AnnotationLines {...RU} showRomanization showHyperliteral />);
    expect(screen.getByTestId('hyperliteral-line')).toBeInTheDocument();

    await user.click(screen.getByTestId('word-mapping-toggle'));
    expect(screen.queryByTestId('hyperliteral-line')).toBeNull();
    // The gloss is on screen once, in the stack, split across its columns.
    expect(screen.getByTestId('interlinear-stack')).toHaveTextContent('To-me');
  });

  it('switches back', async () => {
    const user = userEvent.setup();
    render(<AnnotationLines {...RU} showRomanization showHyperliteral />);
    const toggle = screen.getByTestId('word-mapping-toggle');
    await user.click(toggle);
    await user.click(toggle);
    expect(screen.queryByTestId('interlinear-stack')).toBeNull();
    expect(screen.getByTestId('hyperliteral-line')).toBeInTheDocument();
  });

  it('marks itself pressed, because it swaps a view rather than expanding one', async () => {
    const user = userEvent.setup();
    render(<AnnotationLines {...RU} showRomanization showHyperliteral />);
    const toggle = screen.getByTestId('word-mapping-toggle');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
  });

  it('never reveals a line the learner switched off', async () => {
    const user = userEvent.setup();
    render(
      <AnnotationLines {...RU} showRomanization showHyperliteral={false} />,
    );
    await user.click(screen.getByTestId('word-mapping-toggle'));
    const stack = screen.getByTestId('interlinear-stack');
    expect(stack).toHaveTextContent('mne');
    expect(stack).not.toHaveTextContent('To-me');
  });

  it('still renders the lines themselves when no control is offered', () => {
    render(
      <AnnotationLines
        {...RU}
        hyperliteral="To-me pleases"
        showHyperliteral
        showRomanization={false}
      />,
    );
    expect(screen.getByTestId('hyperliteral-line')).toHaveTextContent(
      'To-me pleases',
    );
  });
});
