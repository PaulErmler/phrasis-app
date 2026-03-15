'use client';

import { Authenticated, AuthLoading } from 'convex/react';
import { FlaskConical, Loader2, Settings } from 'lucide-react';
import Link from 'next/link';
import { TranslationTest } from '@/components/testing/TranslationTest';
import { TTSTest } from '@/components/testing/TTSTest';
import { NotificationTest } from '@/components/testing/NotificationTest';
import { SchedulingTest } from '@/components/testing/SchedulingTest';
import { FlashcardUITest } from '@/components/testing/FlashcardUITest';

export default function TestingPage() {
  return (
    <>
      <AuthLoading>
        <div className="h-screen flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      </AuthLoading>
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
