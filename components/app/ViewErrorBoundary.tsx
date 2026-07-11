'use client';

import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { useTranslations } from 'next-intl';

interface ViewErrorBoundaryInnerProps {
  title: string;
  description: string;
  retryLabel: string;
  children: ReactNode;
}

interface ViewErrorBoundaryState {
  hasError: boolean;
}

/**
 * Class boundary for the view slots rendered directly by the (main) layout.
 * A segment's error.tsx cannot catch errors thrown while rendering that same
 * segment's layout, and all tab views render from the layout's own JSX — so
 * without this, any view error (e.g. a Convex query error thrown into render
 * by useQuery) unwinds to app/error.tsx and replaces the entire shell.
 *
 * Retry resets the boundary; the crashed subtree remounts fresh and Convex
 * queries re-subscribe.
 */
class ViewErrorBoundaryInner extends Component<
  ViewErrorBoundaryInnerProps,
  ViewErrorBoundaryState
> {
  constructor(props: ViewErrorBoundaryInnerProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ViewErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ViewErrorBoundary caught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full flex-1 flex-col items-center justify-center gap-6 px-4 text-center">
          <div className="space-y-2">
            <h2 className="text-2xl font-bold">{this.props.title}</h2>
            <p className="text-muted-foreground max-w-md">
              {this.props.description}
            </p>
          </div>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="rounded-lg bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
          >
            {this.props.retryLabel}
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

/**
 * Wrap one view slot so a failing tab is contained to the view area while
 * the header and bottom nav stay interactive. Give each slot its own
 * instance — one crashing view must not blank its siblings.
 */
export function ViewErrorBoundary({ children }: { children: ReactNode }) {
  const t = useTranslations('ErrorPage');

  return (
    <ViewErrorBoundaryInner
      title={t('title')}
      description={t('description')}
      retryLabel={t('retry')}
    >
      {children}
    </ViewErrorBoundaryInner>
  );
}
