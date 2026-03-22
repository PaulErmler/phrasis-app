import type { Metadata } from 'next';
import './landing-page.css';
import { Footer } from '@/components/Footer';
import { HeroSection } from '@/components/landing/hero-section';
import { PhilosophySection } from '@/components/landing/philosophy-section';
import { LandingDemoProvider } from '@/components/landing/landing-demo-context';
import { ReviewModesSection } from '@/components/landing/review-modes-section';
import { ChatFlashcardSection } from '@/components/landing/chat-flashcard-section';
import { FeaturesSection } from '@/components/landing/features-section';
import { PricingSection } from '@/components/landing/pricing-section';
import { FAQSection } from '@/components/landing/faq-section';
import { DonationSection } from '@/components/landing/donation-section';
import { InstallCtaSection } from '@/components/landing/install-cta-section';
import { getToken } from '@/lib/auth-server';
import { LandingJsonLd } from '@/components/landing/landing-json-ld';

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
        <HeroSection isAuthenticated={isAuthenticated} />
        <PhilosophySection />
        <LandingDemoProvider>
          <ReviewModesSection />
          <ChatFlashcardSection />
        </LandingDemoProvider>
        <FeaturesSection />
        <PricingSection />

        <FAQSection />
        <DonationSection />
        <InstallCtaSection />
      </main>
      <Footer />
    </div>
  );
}
