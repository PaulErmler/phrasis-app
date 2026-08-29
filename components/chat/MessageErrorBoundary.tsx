'use client';

import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { AlertTriangle } from 'lucide-react';

import { reportError } from '@/lib/report-error';

interface MessageErrorBoundaryProps {
  children: ReactNode;
  fallbackMessage?: string;
  retryLabel?: string;
}

interface MessageErrorBoundaryState {
  hasError: boolean;
}

export class MessageErrorBoundary extends Component<
  MessageErrorBoundaryProps,
  MessageErrorBoundaryState
> {
  constructor(props: MessageErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): MessageErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError(error, {
      boundary: 'chat-message',
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive/70" />
          <span>
            {this.props.fallbackMessage ?? "This message couldn't be displayed"}
          </span>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="ml-auto shrink-0 text-xs font-medium text-primary hover:underline"
          >
            {this.props.retryLabel ?? 'Try again'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Broader boundary for the entire chat panel
// ---------------------------------------------------------------------------

interface ChatErrorBoundaryProps {
  children: ReactNode;
  fallbackMessage?: string;
  retryLabel?: string;
}

interface ChatErrorBoundaryState {
  hasError: boolean;
}

export class ChatErrorBoundary extends Component<
  ChatErrorBoundaryProps,
  ChatErrorBoundaryState
> {
  constructor(props: ChatErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ChatErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError(error, {
      boundary: 'chat-panel',
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center gap-4 h-full w-full p-8 text-center">
          <AlertTriangle className="h-8 w-8 text-destructive/70" />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              {this.props.fallbackMessage ?? 'Something went wrong'}
            </p>
          </div>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="rounded-lg bg-primary px-5 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {this.props.retryLabel ?? 'Try again'}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
