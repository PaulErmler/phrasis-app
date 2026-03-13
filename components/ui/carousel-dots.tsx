'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import type { CarouselApi } from '@/components/ui/carousel';

interface CarouselDotsProps {
  api: CarouselApi | undefined;
  className?: string;
}

export function CarouselDots({ api, className }: CarouselDotsProps) {
  const [currentSnap, setCurrentSnap] = useState(0);
  const [snapCount, setSnapCount] = useState(0);

  useEffect(() => {
    if (!api) return;

    const onSelect = () => {
      setCurrentSnap(api.selectedScrollSnap());
      setSnapCount(api.scrollSnapList().length);
    };

    onSelect();
    api.on('select', onSelect);
    api.on('reInit', onSelect);

    return () => {
      api.off('select', onSelect);
      api.off('reInit', onSelect);
    };
  }, [api]);

  if (snapCount <= 1) return null;

  return (
    <div className={cn('flex justify-center gap-1.5', className)}>
      {Array.from({ length: snapCount }).map((_, i) => (
        <button
          key={i}
          type="button"
          aria-label={`Go to slide ${i + 1}`}
          onClick={() => api?.scrollTo(i)}
          className={cn(
            'rounded-full transition-all',
            i === currentSnap
              ? 'w-6 h-2.5 bg-foreground'
              : 'w-2.5 h-2.5 bg-muted-foreground/30',
          )}
        />
      ))}
    </div>
  );
}
