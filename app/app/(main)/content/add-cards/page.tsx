'use client';

import { useRouter } from 'next/navigation';
import { AddCardsView } from '@/components/app/AddCardsView';

export default function AddCardsPage() {
  const router = useRouter();
  return <AddCardsView onBack={() => router.push('/app')} />;
}
