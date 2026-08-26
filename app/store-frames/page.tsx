import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StoreFramesClient } from './StoreFramesClient';

/**
 * Store screenshot renderer. Not linked from the app.
 *
 * Dev-only: hidden in production unless ENABLE_STORE_SCREENS=1 is set at
 * build time, and always noindexed (same guard as app/screenshots).
 * The actual frame rendering lives in StoreFramesClient (it reads
 * searchParams client-side).
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function StoreFramesPage() {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_STORE_SCREENS !== '1') {
    notFound();
  }
  return <StoreFramesClient />;
}
