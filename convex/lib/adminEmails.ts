import {
  captureMode,
  escapeHtml,
  SUPPORT_EMAIL,
  type AuthEmailCtx,
} from './authEmails';
import { withEmailEnvSubject } from './emailEnv';
import { resend } from './resendClient';
import { rateLimiter } from '../rateLimiter';
import { languageName } from '../../lib/languages';
import type { Doc } from '../_generated/dataModel';

/**
 * Internal notification emails to the support inbox (read by Paul) about
 * notable user events: signups (convex/auth.ts onCreate) and subscription
 * changes (usage/helpers.ts syncAllFeatures).
 *
 * Best-effort by design: the send is wrapped in try/catch so a notification
 * can never fail the mutation it rides on (signup, billing sync), the
 * failed component subtransaction rolls back alone.
 *
 * Skipped entirely in E2E capture mode: Playwright runs create users and
 * flip plans constantly, and none of that should reach the real inbox.
 */

const FROM = `Flexling <${SUPPORT_EMAIL}>`;

export async function sendAdminNotificationEmail(
  ctx: AuthEmailCtx,
  { subject, lines }: { subject: string; lines: string[] },
): Promise<void> {
  if (captureMode()) return;
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222222;">',
    ...lines.map(
      (line) => `<p style="margin:0 0 8px;">${escapeHtml(line)}</p>`,
    ),
    '</div>',
  ].join('\n');
  const text = lines.join('\n');
  try {
    // Signup notifications sit behind an unauthenticated endpoint, so a
    // global cap keeps mass signups from flooding the inbox 1:1. Dropping
    // is fine. These are best-effort heads-ups, not records.
    const { ok } = await rateLimiter.limit(ctx, 'adminEmail');
    if (!ok) return;
    const labeledSubject = withEmailEnvSubject(subject);
    await resend.sendEmail(ctx, {
      from: FROM,
      to: SUPPORT_EMAIL,
      subject: labeledSubject,
      html,
      text,
    });
  } catch (err) {
    console.error(`Admin notification email failed (${subject}):`, err);
  }
}

// ============================================================================
// New-signup notification content
// ============================================================================

/**
 * Delay between signup and the admin heads-up. Long enough for the user to
 * have finished (or abandoned) onboarding, so the email can report the chosen
 * course and how far they got instead of just an address. Lives here (not in
 * features/signupNotification.ts) so convex/auth.ts can import it without a
 * circular auth ↔ feature dependency, same split as lib/welcomeEmail.ts.
 */
export const SIGNUP_NOTIFICATION_DELAY_MS = 20 * 60_000;

export interface SignupNotificationInput {
  name: string;
  email: string;
  emailVerified: boolean;
  onboarding: Pick<
    Doc<'onboardingProgress'>,
    | 'step'
    | 'completedAt'
    | 'currentLevel'
    | 'placementTest'
    | 'firstLessonCardsRated'
    | 'firstLessonSummary'
    | 'dailyTimeGoalMinutes'
    | 'learningGoals'
    | 'learningGoalFreeText'
    | 'acquisitionSource'
    | 'acquisitionSourceFreeText'
  > | null;
  course: Pick<
    Doc<'courses'>,
    'baseLanguages' | 'targetLanguages' | 'currentLevel'
  > | null;
  stats: Pick<Doc<'courseStats'>, 'totalRepetitions' | 'totalTimeMs'> | null;
}

const languageNames = (codes: string[]): string =>
  codes.map(languageName).join(' + ');

const formatMinutes = (ms: number): string =>
  ms < 60_000 ? '<1 min' : `${Math.round(ms / 60_000)} min`;

/** 'upper_intermediate' → 'upper intermediate'. */
const levelLabel = (level: string): string => level.replaceAll('_', ' ');

/**
 * Subject + body lines for the delayed new-signup notification. Pure.
 * Exported for tests. Lines with no data are omitted rather than rendered
 * as "(none)" noise; only Name/Email/Course/Onboarding always appear.
 */
export function buildSignupNotification(input: SignupNotificationInput): {
  subject: string;
  lines: string[];
} {
  const { name, email, emailVerified, onboarding, course, stats } = input;

  const coursePair = course
    ? `${languageNames(course.targetLanguages)} ← ${languageNames(course.baseLanguages)}`
    : null;

  const lines: string[] = [
    `Name: ${name || '(none)'}`,
    `Email: ${email} (${emailVerified ? 'verified' : 'not verified yet'})`,
    course
      ? `Course: ${coursePair}${course.currentLevel ? ` · ${levelLabel(course.currentLevel)}` : ''}`
      : 'Course: none created',
  ];

  // Onboarding progress. `completedAt` is the real signal; `step` says how
  // far an abandoned run got.
  if (!onboarding) {
    lines.push('Onboarding: not started');
  } else if (onboarding.completedAt != null) {
    lines.push('Onboarding: completed');
  } else {
    lines.push(`Onboarding: in progress — reached step ${onboarding.step}`);
  }

  if (onboarding) {
    // Placement test: final level when it concluded, else how far they got.
    const placement = onboarding.placementTest;
    if (placement) {
      lines.push(
        placement.finalLevel != null
          ? `Placement: level ${placement.finalLevel} after ${placement.history.length} answers`
          : `Placement: unfinished (${placement.history.length} answers)`,
      );
    } else if (onboarding.currentLevel) {
      lines.push(`Self-assessed level: ${levelLabel(onboarding.currentLevel)}`);
    }

    const summary = onboarding.firstLessonSummary;
    if (summary) {
      lines.push(
        `First lesson: ${summary.cardsRated} cards · ${summary.dailyNewWordsToday} new words · ${formatMinutes(summary.dailyTimeMsToday)}`,
      );
    } else if ((onboarding.firstLessonCardsRated ?? 0) > 0) {
      lines.push(
        `First lesson: ${onboarding.firstLessonCardsRated} cards rated`,
      );
    }

    if (onboarding.dailyTimeGoalMinutes != null) {
      lines.push(`Daily goal: ${onboarding.dailyTimeGoalMinutes} min/day`);
    }
    const goals = [
      ...(onboarding.learningGoals ?? []),
      ...(onboarding.learningGoalFreeText
        ? [`"${onboarding.learningGoalFreeText}"`]
        : []),
    ];
    if (goals.length > 0) lines.push(`Goals: ${goals.join(', ')}`);
    if (onboarding.acquisitionSource) {
      lines.push(
        `Found us via: ${onboarding.acquisitionSource}${
          onboarding.acquisitionSourceFreeText
            ? ` — "${onboarding.acquisitionSourceFreeText}"`
            : ''
        }`,
      );
    }
  }

  // Study activity in the first ~20 minutes (courseStats also counts the
  // onboarding first lesson).
  if (stats && (stats.totalRepetitions > 0 || stats.totalTimeMs > 0)) {
    lines.push(
      `Study so far: ${stats.totalRepetitions} reps · ${formatMinutes(stats.totalTimeMs)}`,
    );
  }

  return {
    subject: `New signup: ${email}${coursePair ? ` — ${coursePair}` : ''}`,
    lines,
  };
}
