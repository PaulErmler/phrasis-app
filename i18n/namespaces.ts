/**
 * Top-level message namespaces grouped by the route area whose CLIENT
 * components consume them. Every prop passed to NextIntlClientProvider is
 * serialized into the page HTML, so each area ships only its groups instead
 * of the full ~85-99 KB dictionary. Server components (getTranslations /
 * RSC useTranslations) read the request config directly and are unaffected.
 *
 * Nested providers REPLACE the parent's messages (next-intl v4), so every
 * provider must include SHARED_NAMESPACES itself.
 *
 * tests/unit/i18n/namespace-coverage.test.ts fails when a client component
 * uses a namespace its route area doesn't ship.
 */

/** Needed everywhere: theme/language switchers, error fallbacks, auth UI. */
export const SHARED_NAMESPACES = [
  'Theme',
  'Language',
  'LanguageSelector',
  'ErrorPage',
  'Auth',
  'Footer',
] as const;

/**
 * The authenticated app (/app/*). Includes 'Onboarding' because
 * CreateCourseDialog (course menu) reuses Onboarding.difficulty strings.
 */
export const APP_NAMESPACES = [
  'AppPage',
  'Chat',
  'Checkout',
  'EditCard',
  'EditCardApproval',
  'EnterTexts',
  'FeatureTracking',
  'Features',
  'ImportTexts',
  'LearningMode',
  'LowQuota',
  'Onboarding',
  'Paywall',
  'Pricing',
  'StatsPage',
  'Tutorial',
] as const;

/** Extra namespaces only the onboarding wizard needs on top of APP. */
export const ONBOARDING_NAMESPACES = ['OnboardingTutorial'] as const;

/**
 * The marketing landing page. Includes 'LearningMode' because the landing
 * demos reuse learning-card components.
 */
export const LANDING_NAMESPACES = ['LandingPage', 'LearningMode'] as const;

export type Messages = Record<string, unknown>;

/** Returns the subset of `messages` for the given top-level namespaces. */
export function pickMessages(
  messages: Messages,
  namespaces: ReadonlyArray<string>,
): Messages {
  const picked: Messages = {};
  for (const ns of namespaces) {
    if (ns in messages) picked[ns] = messages[ns];
  }
  return picked;
}
