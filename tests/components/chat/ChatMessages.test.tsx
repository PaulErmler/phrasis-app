import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

/**
 * A tutor reply whose generation failed server-side (provider outage,
 * upstream rate limit) arrives as an assistant message with status
 * `failed` and no content. It used to render as an empty bubble; now the
 * row says what happened and offers a retry.
 */

vi.mock('@convex-dev/agent/react', () => ({
  useSmoothText: (text: string) => [text, { isStreaming: false }],
}));

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

import { ChatMessages } from '@/components/chat/ChatMessages';
import type { ExtendedUIMessage } from '@/lib/types/chat';

function message(overrides: Partial<ExtendedUIMessage>): ExtendedUIMessage {
  return {
    id: 'm1',
    key: 'k1',
    role: 'assistant',
    status: 'success',
    order: 1,
    stepOrder: 1,
    text: '',
    parts: [],
    _creationTime: 0,
    ...overrides,
  } as ExtendedUIMessage;
}

const user = message({
  id: 'u1',
  key: 'ku1',
  role: 'user',
  order: 1,
  stepOrder: 0,
  text: 'hola?',
  parts: [{ type: 'text', text: 'hola?' }],
});

describe('ChatMessages: failed reply', () => {
  it("shows the failure and retries with the failed row's id", () => {
    const onRetry = vi.fn();
    render(
      <ChatMessages
        messages={[user, message({ id: 'm_failed', status: 'failed' })]}
        isLoading={false}
        threadId="t"
        status="ready"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByTestId('chat-reply-failed')).toHaveTextContent(
      'replyFailed.title',
    );
    fireEvent.click(screen.getByTestId('chat-reply-retry'));
    expect(onRetry).toHaveBeenCalledExactlyOnceWith('m_failed');
  });

  it('keeps the partial content of a reply that failed mid-way, with the notice under it', () => {
    render(
      <ChatMessages
        messages={[
          user,
          message({
            id: 'm_partial',
            status: 'failed',
            text: 'It means',
            parts: [{ type: 'text', text: 'It means' }],
          }),
        ]}
        isLoading={false}
        threadId="t"
        status="ready"
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('It means')).toBeInTheDocument();
    expect(screen.getByTestId('chat-reply-failed')).toBeInTheDocument();
  });

  it('waits while a send or retry is already in flight', () => {
    render(
      <ChatMessages
        messages={[user, message({ id: 'm_failed', status: 'failed' })]}
        isLoading={false}
        threadId="t"
        status="submitted"
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByTestId('chat-reply-retry')).toBeDisabled();
  });

  it('shows nothing of the sort on a reply that arrived', () => {
    render(
      <ChatMessages
        messages={[
          user,
          message({
            text: 'It means hello.',
            parts: [{ type: 'text', text: 'It means hello.' }],
          }),
        ]}
        isLoading={false}
        threadId="t"
        status="ready"
        onRetry={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('chat-reply-failed')).not.toBeInTheDocument();
  });
});

describe('ChatMessages: empty state while loading', () => {
  it('hides the empty state while loading by default', () => {
    render(
      <ChatMessages
        messages={[]}
        isLoading
        threadId="t"
        status="ready"
        emptyStateExtra={<div data-testid="tiles" />}
      />,
    );
    expect(screen.queryByTestId('tiles')).toBeNull();
  });

  it('shows the empty state at once when the thread is known to be empty', () => {
    render(
      <ChatMessages
        messages={[]}
        isLoading
        threadId="t"
        status="ready"
        emptyStateExtra={<div data-testid="tiles" />}
        emptyStateWhileLoading
      />,
    );
    expect(screen.getByTestId('tiles')).toBeInTheDocument();
  });
});
