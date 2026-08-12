import type { Metadata } from 'next';
import './landing-page.css';
import { getToken } from '@/lib/auth-server';
import { LandingJsonLd } from '@/components/landing/landing-json-ld';
import { LandingPageClient } from '@/components/landing/landing-page-client';
import { NativeShellRedirect } from '@/components/NativeShellRedirect';

const siteUrl = process.env.SITE_URL ?? 'https://flexling.com';

export const metadata: Metadata = {
  title: 'Flexling — Vocabulary Building Made Easy',
  description:
    'An audio-based flashcard app with a large database of sentences. Upload your own or ask AI to create flashcards — focus on learning instead of preparing cards. Free to start.',
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
