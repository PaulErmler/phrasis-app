'use client';

import { Quote, Star } from 'lucide-react';
import { TESTIMONIALS } from '../fixtures';

/**
 * "Wall of love" — real user quotes (docs/testimonials.md) styled with the
 * app's design tokens. Used as a store screenshot, not an in-app screen.
 */
export function TestimonialsScreen() {
  return (
    <div className="min-h-dvh bg-background text-foreground flex flex-col">
      <div className="px-6 pt-14 pb-6 text-center space-y-2">
        <div className="flex items-center justify-center gap-1" aria-hidden>
          {Array.from({ length: 5 }, (_, i) => (
            <Star key={i} className="h-5 w-5 fill-amber-400 text-amber-400" />
          ))}
        </div>
        <h1 className="text-2xl font-bold">Loved by language learners</h1>
        <p className="text-sm text-muted-foreground">
          What the community says about Flexling
        </p>
      </div>

      <div className="flex-1 px-4 pb-10 space-y-3 max-w-xl mx-auto w-full">
        {TESTIMONIALS.map((quote) => (
          <figure key={quote} className="card-surface p-4 space-y-2">
            <Quote className="h-4 w-4 text-primary" aria-hidden />
            <blockquote className="text-sm leading-relaxed">{quote}</blockquote>
          </figure>
        ))}
      </div>
    </div>
  );
}
