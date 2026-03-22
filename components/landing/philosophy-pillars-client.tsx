'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useScroll, useTransform, type MotionValue, motion } from 'motion/react';
import { Headphones, Sparkles, MessageCircle } from 'lucide-react';
import { LandingSquircleIcon } from './landing-squircle-icon';

const ICONS = [Headphones, Sparkles, MessageCircle] as const;
const TOTAL = 3;

function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReduce(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return reduce;
}

export type PhilosophyPillar = { title: string; body: string };

function MobilePillarCard({
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
    if (s < 0) return s * 160;
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

type PhilosophyPillarsClientProps = {
  pillars: [PhilosophyPillar, PhilosophyPillar, PhilosophyPillar];
  title: React.ReactNode;
  lead: React.ReactNode;
};

function PillarCardStatic({ pillar, index }: { pillar: PhilosophyPillar; index: number }) {
  const Icon = ICONS[index];
  return (
    <div className="flex flex-col rounded-2xl border border-border/50 bg-card p-6 shadow-sm">
      <LandingSquircleIcon variant={index % 2 === 0 ? 'accent' : 'orange'} className="mb-4">
        <Icon className="h-7 w-7 text-white" />
      </LandingSquircleIcon>
      <h3 className="mb-2 text-lg font-semibold text-foreground">{pillar.title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{pillar.body}</p>
    </div>
  );
}

export function PhilosophyPillarsClient({ pillars, title, lead }: PhilosophyPillarsClientProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  });

  return (
    <>
      <div className="md:hidden">
        <div
          ref={containerRef}
          className={reducedMotion ? 'relative' : 'relative min-h-[160vh]'}
        >
          {reducedMotion ? (
            <div className="mx-auto flex w-full max-w-sm flex-col gap-4 pb-2">
              <div className="mb-8 text-center space-y-4">
                <h2 className="text-3xl font-bold tracking-tight text-foreground">
                  {title}
                </h2>
                <p className="text-base text-muted-foreground leading-relaxed">
                  {lead}
                </p>
              </div>
              {pillars.map((p, index) => (
                <PillarCardStatic key={p.title} pillar={p} index={index} />
              ))}
            </div>
          ) : (
            <div className="sticky top-20 z-[1] mx-auto flex w-full max-w-sm flex-col bg-transparent pb-2 pt-2">
              <div className="relative z-[1] mb-8 text-center space-y-4">
                <h2 className="text-3xl font-bold tracking-tight text-foreground">
                  {title}
                </h2>
                <p className="text-base text-muted-foreground leading-relaxed">
                  {lead}
                </p>
              </div>
              <div className="relative h-[min(52vh,440px)] w-full">
                {pillars.map((p, index) => {
                  const Icon = ICONS[index];
                  return (
                    <MobilePillarCard key={p.title} index={index} progress={scrollYProgress}>
                      <LandingSquircleIcon variant={index % 2 === 0 ? 'accent' : 'orange'} className="mb-4">
                        <Icon className="h-7 w-7 text-white" />
                      </LandingSquircleIcon>
                      <h3 className="mb-2 text-lg font-semibold text-foreground">{p.title}</h3>
                      <p className="text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                    </MobilePillarCard>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="hidden md:grid md:grid-cols-3 gap-6 md:gap-8 max-w-5xl mx-auto">
        {pillars.map((p, index) => {
          const Icon = ICONS[index];
          return (
            <div
              key={p.title}
              className="group relative flex flex-col rounded-2xl border border-border/50 bg-card p-6 md:p-8 shadow-sm transition-shadow hover:shadow-md"
            >
              <LandingSquircleIcon variant={index % 2 === 0 ? 'accent' : 'orange'} className="mb-5">
                <Icon className="h-7 w-7 text-white" />
              </LandingSquircleIcon>
              <h3 className="text-lg font-semibold text-foreground mb-2">{p.title}</h3>
              <p className="text-sm md:text-base text-muted-foreground leading-relaxed">{p.body}</p>
            </div>
          );
        })}
      </div>
    </>
  );
}
