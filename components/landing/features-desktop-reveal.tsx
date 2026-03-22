'use client';

import { type ReactNode } from 'react';

export function FeatureDesktopReveal({ children }: { children: ReactNode }) {
  return <div className="hidden md:block">{children}</div>;
}
