'use client';

import { useRouter } from 'next/navigation';
import { LearnView } from '@/components/app/learning/LearnView';

export function LearnPageClient() {
  const router = useRouter();
  return <LearnView onBack={() => router.push('/app')} />;
}
