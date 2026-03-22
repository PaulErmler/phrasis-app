'use client';

import { useRef, type ReactNode } from 'react';
import { useScroll, useTransform, type MotionValue, motion } from 'motion/react';
import { landingFeatureConfig } from './features-config';
import { LandingSquircleIcon } from './landing-squircle-icon';

const TOTAL = landingFeatureConfig.length;

function MobileFeatureCard({
  index,
  progress,
  children,
}: {
  index: number;
  progress: MotionValue<number>;
  children: ReactNode;
}) {
  const stackIndex = useTransform(progress, (p) => index - p * (TOTAL - 1));

  const y = useTransform(stackIndex, (s) => {
    if (s < 0) return s * 180;
    return 0;
  });

  const scale = useTransform(stackIndex, (s) => {
    if (s < 0) return 1 - s * -0.04;
    return 1;
  });

  const opacity = useTransform(stackIndex, (s) => {
    if (s < -0.5) return 0;
    if (s < 0) return 1 + s * 2;
    if (s > TOTAL + 1) return Math.max(0, 1 - (s - TOTAL - 1) * 0.5);
    return 1;
  });

  const zIndex = TOTAL - index;

  return (
    <motion.div
      style={{ y, scale, opacity, zIndex }}
      className="absolute inset-x-0 top-0 flex flex-col rounded-2xl border border-border/50 bg-card/95 p-6 shadow-xl backdrop-blur-md"
    >
      {children}
    </motion.div>
  );
}

export type FeatureMobileItem = { title: string; description: string };

export type FeaturesMobileStackProps = {
  items: Record<(typeof landingFeatureConfig)[number]['key'], FeatureMobileItem>;
  title: React.ReactNode;
  subtitle: React.ReactNode;
};

export function FeaturesMobileStack({ items, title, subtitle }: FeaturesMobileStackProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  return (
    <div className="md:hidden">
      <div ref={containerRef} className="relative min-h-[200vh]">
        <div className="sticky top-20 z-[1] mx-auto flex w-full max-w-sm flex-col bg-background pb-2 pt-2">
          <div className="relative z-[1] mb-8 text-center">
            <h2 className="text-3xl font-bold tracking-tight text-foreground mb-3">{title}</h2>
            <p className="text-muted-foreground leading-relaxed">{subtitle}</p>
          </div>
          <div className="relative h-[min(58vh,480px)] w-full">
            {landingFeatureConfig.map((f, index) => {
              const Icon = f.icon;
              const item = items[f.key];
              return (
                <MobileFeatureCard key={f.key} index={index} progress={scrollYProgress}>
                  <LandingSquircleIcon variant={index % 2 === 0 ? 'accent' : 'orange'} className="mb-4">
                    <Icon className="h-7 w-7 text-white" />
                  </LandingSquircleIcon>
                  <h3 className="mb-2 text-lg font-semibold text-foreground">{item.title}</h3>
                  <p className="text-sm leading-relaxed text-muted-foreground">{item.description}</p>
                </MobileFeatureCard>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
