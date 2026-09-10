import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

/**
 * Local-development-only routes (`/dev/*`): prototypes and viewers for
 * looking at parts of the app without a session or real data. Never linked
 * from the app.
 *
 * The gate is `NODE_ENV`, which `next dev` sets to `development` and every
 * build (`next build`, and so staging and production on Coolify) sets to
 * `production`. There is deliberately no env-var override, unlike
 * app/screenshots and app/store-frames: nothing under /dev may exist on a
 * deployed host. Belt and braces: the routes are also noindexed and
 * disallowed in robots.ts.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV !== 'development') {
    notFound();
  }
  return children;
}
