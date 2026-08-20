'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { Quote } from 'lucide-react';
import Autoplay from 'embla-carousel-autoplay';
import {
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
  type CarouselApi,
} from '@/components/ui/carousel';
import { CarouselDots } from '@/components/ui/carousel-dots';
import { fadeInUp } from './animations';

// Verbatim user quotes (see docs/testimonials.md), excerpted at sentence
// boundaries only, so they are intentionally not translated. Unattributed
// quotes render without an attribution line.
const TESTIMONIALS: { quote: string; name?: string }[] = [
  {
    quote:
      'My absolute favorite feature is the ability to add custom cards. I already canceled my Glossika subscription as I already like Flexling much better.',
    name: 'Hunter',
  },
  {
    quote:
      'I like the pace of the SRS functionality and that I can slow down the TL speaker to 0.8 or 0.9x to distinguish words that often seem to run together (like particle words). Thank you for creating a better form of the Glossika concept!',
    name: 'Mike',
  },
  {
    quote:
      'You have essentially taken the best aspects of Anki Glossika and Clozemaster combining them into one. I for one can never commit to Anki long term and always burn out, but the audio focused approach of Flexling I can do indefinitely.',
  },
  {
    quote:
      "I'm amazed at the TTS quality, especially since models tend to mess up Levantine Arabic. After comparing native spoken sentences to the same sentence read by Flexling's TTS the pronunciation is practically identical.",
  },
  {
    quote:
      'I found Flexling a few days ago and love it. Good work, exactly what I need!',
    name: 'Selimo',
  },
  {
    quote: "I love it and I'm excited to watch this software grow.",
    name: 'Maya',
  },
  {
    quote:
      "This is awesome, very happy to see that you've added a variety of Arabic dialects.",
    name: 'Joe',
  },
  {
    quote: 'Love the app.',
    name: 'Josh',
  },
  {
    quote:
      "Thanks for making such a fantastic resource! I've always wanted a hands free way to get comprehensible input, Glossika was decent but Flexling far exceeds it.",
  },
  {
    quote: "I'm using Flexling. It's excellent. Highly recommended",
  },
];

export function TestimonialsSection() {
  const t = useTranslations('LandingPage.testimonials');
  const [api, setApi] = useState<CarouselApi>();
  // Lazy state init: a useRef(Autoplay(...)) initializer would construct
  // (and discard) a fresh plugin object on every render.
  const [autoplay] = useState(() =>
    Autoplay({ delay: 5000, stopOnInteraction: true }),
  );

  return (
    <section id="testimonials" className="relative py-20 md:py-32 px-4 sm:px-6 bg-muted/10">
      <div className="max-w-7xl mx-auto">
        <motion.div {...fadeInUp} className="text-center mb-12 md:mb-16">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            {t('title')}{' '}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h2>
        </motion.div>

        <motion.div {...fadeInUp} transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' as const }}>
          <Carousel
            setApi={setApi}
            opts={{ align: 'start', loop: true }}
            plugins={[autoplay]}
          >
            <CarouselContent>
              {TESTIMONIALS.map(({ quote, name }, index) => (
                <CarouselItem
                  key={index}
                  className="sm:basis-1/2 lg:basis-1/3"
                >
                  <figure className="flex flex-col h-full rounded-2xl border border-border/40 bg-card p-6 md:p-7">
                    <Quote className="h-5 w-5 text-primary/60 mb-4 shrink-0" aria-hidden="true" />
                    <blockquote className="text-sm md:text-base text-foreground/90 leading-relaxed flex-1">
                      {quote}
                    </blockquote>
                    {name && (
                      <figcaption className="mt-4 text-sm font-medium text-muted-foreground">
                        — {name}
                      </figcaption>
                    )}
                  </figure>
                </CarouselItem>
              ))}
            </CarouselContent>
            <div className="flex items-center justify-center gap-6 mt-8">
              <CarouselPrevious className="static translate-y-0" />
              <CarouselDots api={api} />
              <CarouselNext className="static translate-y-0" />
            </div>
          </Carousel>
        </motion.div>
      </div>
    </section>
  );
}
