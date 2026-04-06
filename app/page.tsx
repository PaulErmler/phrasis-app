import type { Metadata } from 'next';
import './landing-page.css';
import { getToken } from '@/lib/auth-server';
import { LandingJsonLd } from '@/components/landing/landing-json-ld';
import { LandingPageClient } from '@/components/landing/landing-page-client';

const siteUrl = process.env.SITE_URL ?? 'https://flexling.com';

export const metadata: Metadata = {
  title: 'Flexling — The Language App That Grows With You',
  description:
    'Learn languages your way with audio flashcards, spaced repetition, and AI-powered chat. Bring your own content, practice pronunciation, and build fluency fast. Free to start.',
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
