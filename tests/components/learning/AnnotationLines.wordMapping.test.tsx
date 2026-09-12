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

  it('keeps each language row independent, so a second target works too', async () => {
    // Two target rows on one card. Each AnnotationLines owns its own open
    // state; expanding one must not expand or disturb the other.
    const user = userEvent.setup();
    render(
      <>
        <AnnotationLines
          text="Мне нравится гулять"
          language="ru"
          hyperliteral="To-me pleases to-walk"
          showHyperliteral
          showRomanization={false}
        />
        <AnnotationLines
          text="Jag tycker om att gå"
          language="sv"
          hyperliteral="I like about to walk"
          showHyperliteral
          showRomanization={false}
        />
      </>,
    );
    const toggles = screen.getAllByTestId('word-mapping-toggle');
    expect(toggles).toHaveLength(2);

    await user.click(toggles[1]);
    const stacks = screen.getAllByTestId('interlinear-stack');
    expect(stacks).toHaveLength(1);
    // The one that opened is the SECOND row, with the Swedish sentence.
    expect(stacks[0]).toHaveTextContent('Jag');
    expect(stacks[0]).not.toHaveTextContent('Мне');
    // The first row is untouched and still showing its flat line.
    expect(toggles[0]).toHaveAttribute('aria-pressed', 'false');
    expect(toggles[1]).toHaveAttribute('aria-pressed', 'true');
  });

  it('aligns a five-word sentence to five columns', async () => {
    const user = userEvent.setup();
    render(
      <AnnotationLines
        text="Jag tycker om att gå"
        language="sv"
        hyperliteral="I like about to walk"
        showHyperliteral
        showRomanization={false}
      />,
    );
    await user.click(screen.getByTestId('word-mapping-toggle'));
    expect(screen.getByTestId('interlinear-stack').children).toHaveLength(5);
  });
});
