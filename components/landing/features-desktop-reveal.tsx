'use client';

import { useEffect, useRef } from 'react';

/**
 * Adds `feature-visible` to `.feature-card` elements when they enter the viewport (desktop grid).
 */
export function FeatureDesktopReveal({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const section = ref.current;
    if (!section) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('feature-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' },
    );

    section.querySelectorAll('.feature-card').forEach((card) => observer.observe(card));

    return () => observer.disconnect();
  }, []);

  return <div ref={ref}>{children}</div>;
}
