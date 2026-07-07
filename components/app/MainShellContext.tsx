'use client';

import { createContext, useContext } from 'react';

/**
 * Shell affordances the (main) layout owns but pages need to reach:
 * the course menu (opened from empty states) and the home tutorial restart
 * (registered by HomeView, invoked from the header HelpDialog).
 */
export interface MainShell {
  openCourseMenu: () => void;
  registerTutorialRestart: (restart: (() => void) | null) => void;
}

const MainShellContext = createContext<MainShell | null>(null);

export const MainShellProvider = MainShellContext.Provider;

export function useMainShell(): MainShell {
  const ctx = useContext(MainShellContext);
  if (!ctx) {
    throw new Error('useMainShell must be used within the (main) app layout');
  }
  return ctx;
}
