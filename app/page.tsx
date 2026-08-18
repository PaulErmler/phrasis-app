import type { Metadata } from 'next';
import './landing-page.css';
import { getToken } from '@/lib/auth-server';
import { LandingJsonLd } from '@/components/landing/landing-json-ld';
import { LandingPageClient } from '@/components/landing/landing-page-client';
import { NativeShellRedirect } from '@/components/NativeShellRedirect';

const siteUrl = process.env.SITE_URL ?? 'https://flexling.com';

export const metadata: Metadata = {
  title: 'Flexling — Learn a language the way you learned your first',
  description:
    'You didn’t learn your first language from vocabulary lists. Absorb words in sentences that actually matter to you. Free to start — no credit card required.',
  alternates: {
    canonical: '/',
  },
};

export default async function Home() {
  const token = await getToken();
  const isAuthenticated = !!token;

  return (
    <div className="min-h-screen flex flex-col">
      <NativeShellRedirect />
      <LandingJsonLd siteUrl={siteUrl} />
      <main className="flex-1">
        <LandingPageClient isAuthenticated={isAuthenticated} />
      </main>
    </div>
  );
}
