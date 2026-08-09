/**
 * Copy for the daily reminder push, rendered server-side at send time.
 *
 * Why a hand-rolled string table instead of next-intl: `messages/*.json` is
 * loaded by next-intl through a dynamic import in a Next server context and is
 * not reachable from Convex, and there is no server-side translator anywhere in
 * this codebase (every existing outbound email is deliberately English-only —
 * see convex/lib/authEmails.ts and convex/lib/welcomeEmail.ts). A push,
 * unlike an email, lands on a device the user reads in their own language, so
 * it gets the two locales the app ships.
 *
 * Wording deliberately mirrors `AppPage.dueCounts` in messages/en.json and
 * messages/de.json ("{count} new" / "{count} neu") so the notification and the
 * in-app due pills say the same thing. If those strings change, change these
 * too — `tests/unit/i18n/messages-parity.test.ts` cannot see this file.
 *
 * Pure and separately testable, mirroring the established pure-renderer /
 * thin-sender split (`renderAuthEmail`, `buildSignupNotification`).
 */

/** Locales the app ships. Mirrors `Locale` in i18n/locale.ts. */
export type NotificationLocale = 'en' | 'de';

/** The subset of `deriveStreakDisplay`'s state that changes the copy. */
export type ReminderStreakState =
  | 'active'
  | 'pending'
  | 'frozen'
  | 'broken'
  | 'none';

export type ReminderPayload = {
  title: string;
  body: string;
};

export type ReminderInput = {
  /** Cards due right now for the active deck. */
  dueCount: number;
  /** From `deriveStreakDisplay`. */
  streakState: ReminderStreakState;
  /** `displayStreak` — only used when the streak is worth mentioning. */
  streakDays: number;
};

type Strings = {
  title: string;
  /** No cards due — a nudge to keep the habit rather than a work order. */
  bodyNoneDue: (input: { streakDays: number; streakAtRisk: boolean }) => string;
  /** Cards are waiting. */
  bodyDue: (input: {
    dueCount: number;
    streakDays: number;
    streakAtRisk: boolean;
  }) => string;
};

const STRINGS: Record<NotificationLocale, Strings> = {
  en: {
    title: 'Time to practise',
    bodyNoneDue: ({ streakDays, streakAtRisk }) =>
      streakAtRisk && streakDays > 0
        ? `Nothing due — a quick session keeps your ${streakDays}-day streak alive.`
        : 'Nothing due right now. A few minutes of free study still counts.',
    bodyDue: ({ dueCount, streakDays, streakAtRisk }) => {
      const cards = dueCount === 1 ? '1 card' : `${dueCount} cards`;
      return streakAtRisk && streakDays > 0
        ? `${cards} to review — keep your ${streakDays}-day streak going.`
        : `${cards} to review.`;
    },
  },
  de: {
    title: 'Zeit zum Üben',
    bodyNoneDue: ({ streakDays, streakAtRisk }) =>
      streakAtRisk && streakDays > 0
        ? `Nichts fällig — eine kurze Einheit hält deine ${streakDays}-Tage-Serie am Leben.`
        : 'Gerade nichts fällig. Ein paar Minuten freies Lernen zählen auch.',
    bodyDue: ({ dueCount, streakDays, streakAtRisk }) => {
      const cards = dueCount === 1 ? '1 Karte' : `${dueCount} Karten`;
      return streakAtRisk && streakDays > 0
        ? `${cards} zum Wiederholen — halte deine ${streakDays}-Tage-Serie.`
        : `${cards} zum Wiederholen.`;
    },
  },
};

/** Narrow an arbitrary stored string to a locale we have copy for. */
export function resolveNotificationLocale(
  locale: string | undefined,
): NotificationLocale {
  return locale === 'de' ? 'de' : 'en';
}

/**
 * Build the notification title and body.
 *
 * `pending` and `frozen` are the states worth naming: both mean the streak is
 * still alive but nothing has been studied today, which is exactly the moment a
 * reminder earns its interruption. `active` never reaches here (the sweep skips
 * users who already practised today), and `broken`/`none` get the neutral copy
 * — dangling a streak the user has already lost reads as a taunt.
 */
export function renderDailyReminder(
  locale: NotificationLocale,
  input: ReminderInput,
): ReminderPayload {
  const strings = STRINGS[locale];
  const streakAtRisk =
    input.streakState === 'pending' || input.streakState === 'frozen';
  // Defensive: a negative or non-integer count would only come from a bug, but
  // it would be visible on a lock screen, so normalize rather than interpolate.
  const dueCount = Number.isFinite(input.dueCount)
    ? Math.max(0, Math.floor(input.dueCount))
    : 0;
  const streakDays = Number.isFinite(input.streakDays)
    ? Math.max(0, Math.floor(input.streakDays))
    : 0;

  return {
    title: strings.title,
    body:
      dueCount === 0
        ? strings.bodyNoneDue({ streakDays, streakAtRisk })
        : strings.bodyDue({ dueCount, streakDays, streakAtRisk }),
  };
}
