import './landing-page.css';
import { Footer } from '@/components/Footer';
import { HeroSection } from '@/components/landing/hero-section';
import { FeaturesSection } from '@/components/landing/features-section';
import { PricingSection } from '@/components/landing/pricing-section';
import { TestimonialsSection } from '@/components/landing/testimonials-section';
import { NewsletterSection } from '@/components/landing/newsletter-section';
import { FAQSection } from '@/components/landing/faq-section';
import { DonationSection } from '@/components/landing/donation-section';
import { getToken } from '@/lib/auth-server';

export default async function Home() {
  const token = await getToken();
  const isAuthenticated = !!token;

  return (
    <div className="min-h-screen flex flex-col">
      <main className="flex-1">
        <HeroSection isAuthenticated={isAuthenticated} />
        <FeaturesSection />
        <PricingSection />
        <TestimonialsSection />

        <FAQSection />
        <DonationSection />
        <NewsletterSection />
      </main>
      <Footer />
    </div>
  );
}
