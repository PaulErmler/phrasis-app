'use client';

import { useRef } from 'react';
import { motion, useScroll, useTransform, MotionValue } from 'motion/react';
import { cn } from '@/lib/utils';
import { landingFeatureConfig } from './features-config';

export type FeatureItemCopy = {
  title: string;
  description: string;
};

export type FeaturesMobileStackProps = {
  title: string;
  titleHighlight: string;
  subtitle: string;
  items: Record<(typeof landingFeatureConfig)[number]['key'], FeatureItemCopy>;
};

function MobileFeatureCard({
  feature,
  index,
  total,
  progress,
  copy,
}: {
  feature: (typeof landingFeatureConfig)[number];
  index: number;
  total: number;
  progress: MotionValue<number>;
  copy: FeatureItemCopy;
}) {
  const stackIndex = useTransform(progress, (p) => index - p * (total - 1));

  const y = useTransform(stackIndex, (s) => {
    if (s < 0) return s * 200;
    return s * 12;
  });

  const x = useTransform(stackIndex, (s) => {
    if (s < 0) return 0;
    return s * 12;
  });

  const scale = useTransform(stackIndex, (s) => {
    if (s < 0) return 1 - s * -0.05;
    return Math.max(1 - s * 0.05, 0.8);
  });

  const opacity = useTransform(stackIndex, (s) => {
    if (s < -0.5) return 0;
    if (s < 0) return 1 + s * 2;
    if (s > 3) return Math.max(0, 1 - (s - 3) * 0.5);
    return 1;
  });

  const zIndex = total - index;

  return (
    <motion.div
      style={{ y, x, scale, opacity, zIndex }}
      className="absolute top-0 left-0 right-0 p-8 rounded-2xl border border-border/50 bg-card/95 backdrop-blur-md shadow-xl"
    >
      <div className="relative w-16 h-16 mb-6 feature-icon-wrapper">
        <div
          className={cn(
            'feature-icon-bg absolute top-2 left-2 w-14 h-14 rounded-[14px]',
            feature.color === 'accent' ? 'bg-[#FFB300]' : 'bg-[#F97316]',
          )}
        />
        <div className="feature-icon-fg absolute top-0 left-0 w-14 h-14 rounded-[14px] flex items-center justify-center shadow-lg bg-primary">
          <feature.icon className="w-7 h-7 text-white" />
        </div>
      </div>

      <h3 className="text-xl font-semibold mb-3 text-foreground">{copy.title}</h3>
      <p className="text-muted-foreground leading-relaxed">{copy.description}</p>
    </motion.div>
  );
}

export function FeaturesMobileStack({
  title,
  titleHighlight,
  subtitle,
  items,
}: FeaturesMobileStackProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  return (
    <>
      <div className="md:hidden">
        <div ref={containerRef} className="relative min-h-[220vh]">
          <div className="sticky top-20 z-[1] mx-auto flex w-full max-w-sm flex-col bg-background pt-2 pb-6">
            <div className="relative z-[1] mb-8 text-center">
              <h2 className="mb-4 text-3xl font-bold tracking-tight">
                {title} <span className="gradient-text">{titleHighlight}</span>
              </h2>
              <p className="text-lg text-muted-foreground">{subtitle}</p>
            </div>

            <div className="relative h-[min(52vh,420px)] w-full">
              {landingFeatureConfig.map((feature, index) => (
                <MobileFeatureCard
                  key={feature.key}
                  feature={feature}
                  index={index}
                  total={landingFeatureConfig.length}
                  progress={scrollYProgress}
                  copy={items[feature.key]}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
