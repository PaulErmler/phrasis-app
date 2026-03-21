import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const SQUIRCLE_BACK = {
  orange: 'bg-[#F97316]',
  accent: 'bg-[#FFB300]',
} as const;

type LandingSquircleIconProps = {
  children: ReactNode;
  className?: string;
  /** Back squircle: orange (default) or yellow accent like feature cards */
  variant?: keyof typeof SQUIRCLE_BACK;
  /** Override back layer color (wins over variant) */
  backClassName?: string;
};

export function LandingSquircleIcon({
  children,
  className,
  variant = 'orange',
  backClassName,
}: LandingSquircleIconProps) {
  const back = backClassName ?? SQUIRCLE_BACK[variant];

  return (
    <div className={cn('relative h-16 w-16 shrink-0', className)}>
      <div
        className={cn(
          'absolute top-2 left-2 h-14 w-14 rounded-[14px]',
          back,
        )}
        aria-hidden
      />
      <div className="absolute top-0 left-0 flex h-14 w-14 items-center justify-center rounded-[14px] bg-primary shadow-lg">
        {children}
      </div>
    </div>
  );
}
