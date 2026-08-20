'use client';

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useTranslations } from 'next-intl';

import { reportError } from '@/lib/report-error';

interface ErrorBoundaryProps {
  /**
   * Rendered in place of the children after a crash. Receives a `retry`
   * that resets the boundary. The subtree remounts fresh and Convex
   * queries re-subscribe. Return `null` for a boundary that should fail
   * invisibly.
   */
  fallback: (retry: () => void) => ReactNode;
  /** Tag on the error report, so crashes are attributable to a location. */
  boundary: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * The app's single error-boundary implementation. React only supports class
 * components here, so everything that needs to contain a crash composes this
 * one with a different `fallback` rather than declaring its own class.
 */
class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError(error, {
      boundary: this.props.boundary,
      componentStack: errorInfo.componentStack,
    });
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return this.props.fallback(() => this.setState({ hasError: false }));
  }
}

/**
 * Wrap one view slot so a failing tab is contained to the view area while
 * the header and bottom nav stay interactive. Give each slot its own
 * instance. One crashing view must not blank its siblings.
 *
 * A segment's error.tsx cannot catch errors thrown while rendering that same
 * segment's layout, and all tab views render from the layout's own JSX, so
 * without this, any view error (e.g. a Convex query error thrown into render
 * by useQuery) unwinds to app/error.tsx and replaces the entire shell.
 */
export function ViewErrorBoundary({ children }: { children: ReactNode }) {
  const t = useTranslations('ErrorPage');

  return (
    <ErrorBoundary
      boundary="view"
      fallback={(retry) => (
        <div className="flex h-full flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">{t('title')}</h2>
            <p className="text-muted-foreground max-w-md">{t('description')}</p>
          </div>
          <button
            onClick={retry}
            className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t('retry')}
          </button>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * Contain a crash with no visible trace. For non-essential chrome that sits
 * OUTSIDE the view boundaries, notably anything in the app header, where an
 * escaping error would unwind to app/error.tsx and replace the whole shell.
 * An error card in a header slot would be worse than an absent widget, so
 * the fallback renders nothing; the crash is still reported.
 */
export function SilentErrorBoundary({
  boundary,
  children,
}: {
  boundary: string;
  children: ReactNode;
}) {
  return (
    <ErrorBoundary boundary={boundary} fallback={() => null}>
      {children}
    </ErrorBoundary>
  );
}
