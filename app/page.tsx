import type { Metadata } from 'next';
import './landing-page.css';
import { getToken } from '@/lib/auth-server';
import { LandingJsonLd } from '@/components/landing/landing-json-ld';
import { LandingPageClient } from '@/components/landing/landing-page-client';

const siteUrl = process.env.SITE_URL ?? 'https://flexling.com';

export const metadata: Metadata = {
  title: 'Flexling — Language Learning on Autopilot',
  description:
    'Get fluent by shadowing real sentences, writing them, and listening all day — powered by spaced repetition (the same algorithm as Anki) and a built-in AI tutor. Just 15 minutes a day. Free to start.',
  alternates: {
    canonical: '/',
  },
};

export default async function Home() {
  const token = await getToken();
  const isAuthenticated = !!token;

  return (
    <div className="min-h-screen flex flex-col">
      <LandingJsonLd siteUrl={siteUrl} />
      <main className="flex-1">
        <LandingPageClient isAuthenticated={isAuthenticated} />
      </main>
    </div>
  );
}
