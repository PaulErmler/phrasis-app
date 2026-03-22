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

export default async function Home() {
  const token = await getToken();
  const isAuthenticated = !!token;

  return (
    <div className="min-h-screen flex flex-col">
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
