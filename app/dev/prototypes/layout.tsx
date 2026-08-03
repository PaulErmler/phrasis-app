import { notFound } from 'next/navigation';
import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Dev-only prototype gallery. Pages under /dev/prototypes render real app
 * components on mock data so UI variants can be compared side by side before
 * one is wired up for real. Unreachable in production builds.
 */
export default function PrototypesLayout({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV !== 'development') notFound();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto flex h-12 items-center gap-4 px-4 text-sm">
          <span className="font-semibold">Prototypes</span>
          <nav className="flex items-center gap-3 text-muted-foreground">
            <Link href="/dev/prototypes/listening-strategy" className="hover:text-foreground">
              Listening strategy
            </Link>
            <Link href="/dev/prototypes/projection-step" className="hover:text-foreground">
              Projection step
            </Link>
          </nav>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">{children}</main>
    </div>
  );
}
