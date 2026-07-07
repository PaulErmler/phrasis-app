'use client';

import { LandingDemoProvider } from '@/components/landing/landing-demo-context';
import { LandingHeader } from '@/components/landing/landing-header';
import { HeroSection } from '@/components/landing/hero-section';
import { PhilosophySection } from '@/components/landing/philosophy-section';
import { ReviewModesSection } from '@/components/landing/review-modes-section';
import { ChatFlashcardSection } from '@/components/landing/chat-flashcard-section';
import { FeaturesSection } from '@/components/landing/features-section';
import { LanguagesSection } from '@/components/landing/languages-section';
import { AnalyticsSection } from '@/components/landing/analytics-section';
import { PricingSection } from '@/components/landing/pricing-section';
import { FAQSection } from '@/components/landing/faq-section';
import { DonationSection } from '@/components/landing/donation-section';
import { InstallCtaSection } from '@/components/landing/install-cta-section';
import { LandingFooter } from '@/components/landing/landing-footer';

interface LandingPageClientProps {
  isAuthenticated: boolean;
}

export function LandingPageClient({ isAuthenticated }: LandingPageClientProps) {
  return (
    <>
      <LandingHeader isAuthenticated={isAuthenticated} />
      <HeroSection isAuthenticated={isAuthenticated} />
      <PhilosophySection />
      <LandingDemoProvider>
        <ReviewModesSection />
        <ChatFlashcardSection />
      </LandingDemoProvider>
      <AnalyticsSection />
      <FeaturesSection />
      <LanguagesSection />
      <PricingSection />
      <FAQSection />
      <DonationSection />
      <InstallCtaSection />
      <LandingFooter />
    </>
  );
}
