import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import {
  LearningChatLayout,
  useLearningChatToggle,
} from '@/components/app/learning/LearningChatLayout';

/**
 * Phone layout (viewport below the `lg` breakpoint): the chat panel slides
 * in over the card and gets its own history entry so an edge-swipe back
 * closes the chat instead of leaving the learn session.
 */

function installMatchMedia(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

function Probe() {
  const ctx = useLearningChatToggle()!;
  return (
    <div>
      <span data-testid="open-state">{ctx.isChatOpen ? 'open' : 'closed'}</span>
      <button data-testid="open" onClick={ctx.openChat} />
      <button data-testid="close" onClick={ctx.closeChat} />
    </div>
  );
}

function renderLayout() {
  return render(
    <LearningChatLayout header={<div />} chatPanel={<div data-testid="chat" />}>
      <Probe />
    </LearningChatLayout>,
  );
}

const panel = () => document.querySelector('[data-learning-chat-panel]')!;

beforeEach(() => {
  installMatchMedia(false);
  window.history.replaceState(null, '', '/app/learn');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LearningChatLayout on a phone', () => {
  it('slides the chat in from the right and pushes a history entry', async () => {
    renderLayout();
    expect(panel().className).toContain('hidden');

    fireEvent.click(screen.getByTestId('open'));
    await waitFor(() =>
      expect(panel().className).toContain('slide-in-from-right'),
    );
    expect(panel().className).toContain('animate-in');
    expect(window.history.state?.learnChatOpen).toBe(true);
    expect(window.location.pathname).toBe('/app/learn');
  });

  it('closes the chat when its history entry is popped (swipe back)', async () => {
    renderLayout();
    fireEvent.click(screen.getByTestId('open'));
    await waitFor(() => expect(window.history.state?.learnChatOpen).toBe(true));

    act(() => {
      window.history.back();
    });
    await waitFor(() =>
      expect(screen.getByTestId('open-state')).toHaveTextContent('closed'),
    );
    // Slides out, then leaves the DOM flow once the animation is over.
    expect(panel().className).toContain('slide-out-to-right');
    await waitFor(() => expect(panel().className).toContain('hidden'));
    expect(window.location.pathname).toBe('/app/learn');
  });

  it('pops its own entry on a programmatic close so the next back is not a dead swipe', async () => {
    renderLayout();
    fireEvent.click(screen.getByTestId('open'));
    await waitFor(() => expect(window.history.state?.learnChatOpen).toBe(true));

    fireEvent.click(screen.getByTestId('close'));
    await waitFor(() =>
      expect(window.history.state?.learnChatOpen).toBeFalsy(),
    );
    expect(screen.getByTestId('open-state')).toHaveTextContent('closed');
  });
});

describe('LearningChatLayout on desktop', () => {
  it('does not touch history for the sidebar', async () => {
    installMatchMedia(true);
    renderLayout();
    fireEvent.click(screen.getByTestId('open'));
    await waitFor(() =>
      expect(screen.getByTestId('open-state')).toHaveTextContent('open'),
    );
    expect(window.history.state?.learnChatOpen).toBeFalsy();
  });
});
