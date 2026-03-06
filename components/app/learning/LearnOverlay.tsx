'use client';

import { useRouter } from 'next/navigation';
import { LearnView } from './LearnView';

export function LearnOverlay() {
  const router = useRouter();
  return (
    <div className="fixed inset-0 z-50 bg-background">
      <LearnView onBack={() => router.back()} />
    </div>
  );
}
