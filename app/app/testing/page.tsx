'use client';

import { RedirectToSignIn } from '@daveyplate/better-auth-ui';
import { Authenticated } from 'convex/react';
import { FlaskConical, Settings } from 'lucide-react';
import Link from 'next/link';
import { TranslationTest } from '@/components/testing/TranslationTest';
import { TTSTest } from '@/components/testing/TTSTest';
import { NotificationTest } from '@/components/testing/NotificationTest';
import { SchedulingTest } from '@/components/testing/SchedulingTest';
import { CollectionsPreview } from '@/components/testing/CollectionsPreview';
import { CollectionCarouselTest } from '@/components/testing/CollectionCarouselTest';
import { FlashcardUITest } from '@/components/testing/FlashcardUITest';

export default function TestingPage() {
  return (
    <>
      <RedirectToSignIn />
      <Authenticated>
        <div className="max-w-5xl mx-auto p-4">
          {/* Page Header */}
          <div className="text-center py-4 mb-6">
            <div className="flex items-center justify-center gap-2 mb-2">
              <FlaskConical className="h-6 w-6" />
              <h1 className="text-2xl font-bold">Testing</h1>
            </div>
            <p className="text-muted-sm">
              Test various app features and integrations
            </p>
          </div>

          {/* Responsive Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Scheduling Test Card — spans full width */}
            <div className="md:col-span-2">
              <SchedulingTest />
            </div>

            <div className="md:col-span-2 lg:col-span-1">
              <TranslationTest />
            </div>

            <div className="md:col-span-2 lg:col-span-1">
              <TTSTest />
            </div>

            <NotificationTest />

            <div className="md:col-span-2 lg:col-span-1">
              <CollectionsPreview />
            </div>

            {/* Collection Carousel UI Test */}
            <div className="md:col-span-2">
              <CollectionCarouselTest />
            </div>

            {/* Flashcard UI States Test */}
            <div className="md:col-span-2">
              <FlashcardUITest />
            </div>

            {/* Settings UI Prototypes */}
            <div className="md:col-span-2">
              <Link
                href="/app/testing/settings"
                className="block rounded-xl border p-4 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-2">
                  <Settings className="h-5 w-5" />
                  <span className="font-medium">Settings UI Prototypes</span>
                </div>
                <p className="text-muted-sm text-sm">
                  4 different approaches for audio playback settings
                </p>
              </Link>
            </div>
          </div>
        </div>
      </Authenticated>
    </>
  );
}
