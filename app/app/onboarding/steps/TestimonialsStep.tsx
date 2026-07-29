'use client';

import { useTranslations } from 'next-intl';
import { Quote } from 'lucide-react';

// Verbatim user quotes (see docs/testimonials.md) — excerpted at sentence
// boundaries only, so they are intentionally not translated. Shown without
// attribution.
const TESTIMONIALS: string[] = [
  'My absolute favorite feature is the ability to add custom cards. I already canceled my Glossika subscription as I already like Flexling much better.',
  'I like the pace of the SRS functionality and that I can slow down the TL speaker to 0.8 or 0.9x to distinguish words that often seem to run together (like particle words). Thank you for creating a better form of the Glossika concept!',
  'You have essentially taken the best aspects of Anki Glossika and Clozemaster combining them into one. I for one can never commit to Anki long term and always burn out, but the audio focused approach of Flexling I can do indefinitely.',
  "I'm amazed at the TTS quality, especially since models tend to mess up Levantine Arabic. After comparing native spoken sentences to the same sentence read by Flexling's TTS the pronunciation is practically identical.",
  "Thanks for making such a fantastic resource! I've always wanted a hands free way to get comprehensible input, Glossika was decent but Flexling far exceeds it.",
];

/**
 * Social-proof step shown between the feature tour and the plan picker.
 * Uses the shared wizard footer's Continue button (no own CTA).
 */
export function TestimonialsStep() {
  const t = useTranslations('Onboarding.testimonials');
  return (
    <div
      data-testid="onboarding-step-testimonials"
      className="h-full overflow-y-auto animate-in fade-in slide-in-from-bottom-4 duration-500"
    >
      <div className="min-h-full flex flex-col justify-center py-6">
        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold">{t('title')}</h2>
          <p className="text-sm text-muted-foreground mt-1">{t('subtitle')}</p>
        </div>
        <div className="flex flex-col gap-3 max-w-2xl mx-auto w-full">
          {TESTIMONIALS.map((quote, index) => (
            <figure
              key={index}
              className="rounded-xl border border-border/40 bg-card p-5"
            >
              <div className="flex gap-3">
                <Quote className="h-5 w-5 text-primary/60 shrink-0 mt-0.5" aria-hidden="true" />
                <blockquote className="text-sm text-foreground/90 leading-relaxed">
                  {quote}
                </blockquote>
              </div>
            </figure>
          ))}
        </div>
      </div>
    </div>
  );
}
