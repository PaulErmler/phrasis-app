import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HomeScreen } from '../screens/HomeScreen';
import { ChatScreen } from '../screens/ChatScreen';
import { ReviewScreen } from '../screens/ReviewScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { TestimonialsScreen } from '../screens/TestimonialsScreen';
import { LanguagesScreen } from '../screens/LanguagesScreen';
import { CustomScreen } from '../screens/CustomScreen';
import { WritingScreen } from '../screens/WritingScreen';
import { RadioScreen } from '../screens/RadioScreen';

/**
 * Store-screenshot pages (scripts/store-screenshots.ts renders these with
 * Playwright). Real app components + design tokens, mocked data, no Convex.
 *
 * Dev-only: hidden in production unless ENABLE_STORE_SCREENS=1 is set at
 * build time, and always noindexed.
 */

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

const SCREENS = {
  home: HomeScreen,
  chat: ChatScreen,
  review: ReviewScreen,
  stats: StatsScreen,
  testimonials: TestimonialsScreen,
  languages: LanguagesScreen,
  custom: CustomScreen,
  writing: WritingScreen,
  radio: RadioScreen,
} as const;

export default async function ScreenshotPage({
  params,
}: {
  params: Promise<{ screen: string }>;
}) {
  if (
    process.env.NODE_ENV === 'production' &&
    process.env.ENABLE_STORE_SCREENS !== '1'
  ) {
    notFound();
  }
  const { screen } = await params;
  const Screen = SCREENS[screen as keyof typeof SCREENS];
  if (!Screen) notFound();
  return <Screen />;
}
