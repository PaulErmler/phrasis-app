import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

type LandingSquircleIconProps = {
  children: ReactNode;
  className?: string;
  /** @deprecated No longer used — kept for compatibility */
  variant?: string;
  /** @deprecated No longer used — kept for compatibility */
  backClassName?: string;
};

export function LandingSquircleIcon({
  children,
  className,
}: LandingSquircleIconProps) {
  return (
    <div className={cn('relative flex items-center justify-center h-16 w-16 shrink-0', className)}>
      {/* Clip container: overflow visible on top/left/right, clipped at blue square's bottom */}
      <div className="absolute inset-0" style={{ clipPath: 'inset(-20px -20px 4px -20px)' }} aria-hidden>
        {/* Back layer: orange (furthest back, most rotated) */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-14 w-14 rounded-[7px] -rotate-[30deg] bg-[#F97316]" />
        </div>
        {/* Middle layer: yellow */}
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-14 w-14 rounded-[7px] -rotate-[15deg] bg-[#FFB300]" />
        </div>
      </div>
      {/* Front layer: blue icon */}
      <div className="absolute flex h-14 w-14 items-center justify-center rounded-[7px] bg-primary shadow-lg">
        {children}
      </div>
    </div>
  );
}
