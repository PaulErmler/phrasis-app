'use client';

import { useEffect } from 'react';

import { posthog } from '@/lib/posthog/client';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // This boundary replaces the root layout, so it is the only place a crash
    // in the layout itself (providers, fonts, intl) can be observed at all.
    // Called directly rather than via `reportError`, which pulls in more of the
    // app than is safe to trust at this point, and guarded, because a throw
    // here would crash the crash page itself.
    try {
      posthog.captureException(error, { boundary: 'global-error', digest: error.digest });
    } catch {
      // Nothing left to report to.
    }
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div
          style={{
            display: 'flex',
            minHeight: '100vh',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1.5rem',
            padding: '1rem',
            textAlign: 'center',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <div>
            <h2 style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '0.5rem' }}>
              Something went wrong
            </h2>
            <p style={{ color: '#666', maxWidth: '28rem' }}>
              A critical error occurred. Please try again.
            </p>
          </div>
          <button
            onClick={reset}
            style={{
              borderRadius: '0.5rem',
              backgroundColor: '#2cb5d4',
              padding: '0.625rem 1.5rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'white',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
