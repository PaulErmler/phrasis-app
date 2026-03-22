'use client';

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

type LandingDemoContextValue = {
  /** Matches the “multiple bases + targets” toggle in the review demo (Pro-style course). */
  multiCourse: boolean;
  setMultiCourse: (value: boolean) => void;
};

const LandingDemoContext = createContext<LandingDemoContextValue | null>(null);

export function LandingDemoProvider({ children }: { children: ReactNode }) {
  const [multiCourse, setMultiCourse] = useState(false);
  const value = useMemo(
    () => ({ multiCourse, setMultiCourse }),
    [multiCourse],
  );
  return (
    <LandingDemoContext.Provider value={value}>{children}</LandingDemoContext.Provider>
  );
}

export function useLandingDemo() {
  const ctx = useContext(LandingDemoContext);
  if (!ctx) {
    throw new Error('useLandingDemo must be used within LandingDemoProvider');
  }
  return ctx;
}
