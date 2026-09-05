import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  buildSignupNotification,
  sendAdminNotificationEmail,
  type SignupNotificationInput,
} from '../../lib/adminEmails';
import type { AuthEmailCtx } from '../../lib/authEmails';
import { describePlanChange } from '../../usage/helpers';

describe('sendAdminNotificationEmail', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('is skipped entirely in E2E capture mode', async () => {
    vi.stubEnv('E2E_TEST_HOOKS', '1');
    // A ctx that would throw on any use. Proves nothing is called.
    const ctx = new Proxy(
      {},
      {
        get() {
          throw new Error('ctx must not be touched in capture mode');
        },
      },
    ) as AuthEmailCtx;
    await expect(
      sendAdminNotificationEmail(ctx, { subject: 'x', lines: ['y'] }),
    ).resolves.toBeUndefined();
  });

  it('never throws when the send fails (best-effort)', async () => {
    const ctx = {
      runMutation: vi.fn(async () => {
        throw new Error('resend down');
      }),
    } as unknown as AuthEmailCtx;
    await expect(
      sendAdminNotificationEmail(ctx, { subject: 'x', lines: ['y'] }),
    ).resolves.toBeUndefined();
  });
});

describe('buildSignupNotification', () => {
  const fullInput: SignupNotificationInput = {
    name: 'Anna Schmidt',
    email: 'anna@example.com',
    emailVerified: true,
    onboarding: {
      step: 12,
      completedAt: 1_754_000_000_000,
      currentLevel: 'elementary',
      placementTest: {
        strategy: 'bayesian',
        history: [
          { level: 1, knew: true },
          { level: 3, knew: true },
          { level: 5, knew: false },
        ],
        finalLevel: 4,
      },
      firstLessonCardsRated: 8,
      firstLessonSummary: {
        cardsRated: 8,
        sessionId: 's1',
        dailyReviewsToday: 8,
        dailyTimeMsToday: 272_000,
        dailyNewWordsToday: 6,
      },
      dailyTimeGoalMinutes: 20,
      learningGoals: ['travel', 'family'],
      learningGoalFreeText: 'moving to Madrid',
      priorApps: ['anki', 'duolingo', 'other'],
      priorAppsFreeText: 'Memrise',
      acquisitionSource: 'tiktok',
      acquisitionSourceFreeText: 'saw a video',
    },
    course: {
      baseLanguages: ['en'],
      targetLanguages: ['es'],
      currentLevel: 'elementary',
    },
    stats: { totalRepetitions: 23, totalTimeMs: 432_000 },
  };

  it('reports course, completed onboarding, and activity for a full signup', () => {
    const { subject, lines } = buildSignupNotification(fullInput);
    expect(subject).toBe(
      'New signup: anna@example.com — Spanish (Spain) ← English',
    );
    expect(lines).toEqual([
      'Name: Anna Schmidt',
      'Email: anna@example.com (verified)',
      'Course: Spanish (Spain) ← English · elementary',
      'Onboarding: completed',
      'Placement: level 4 after 3 answers',
      'First lesson: 8 cards · 6 new words · 5 min',
      'Daily goal: 20 min/day',
      'Goals: travel, family, "moving to Madrid"',
      'Apps used before: anki, duolingo, other, "Memrise"',
      'Found us via: tiktok — "saw a video"',
      'Study so far: 23 reps · 7 min',
    ]);
  });

  it('degrades to the bare facts for an abandoned pre-onboarding signup', () => {
    const { subject, lines } = buildSignupNotification({
      name: '',
      email: 'ghost@example.com',
      emailVerified: false,
      onboarding: null,
      course: null,
      stats: null,
    });
    expect(subject).toBe('New signup: ghost@example.com');
    expect(lines).toEqual([
      'Name: (none)',
      'Email: ghost@example.com (not verified yet)',
      'Course: none created',
      'Onboarding: not started',
    ]);
  });

  it('reports the reached step and unfinished placement for a mid-onboarding user', () => {
    const { lines } = buildSignupNotification({
      ...fullInput,
      onboarding: {
        ...fullInput.onboarding!,
        completedAt: undefined,
        step: 7,
        placementTest: {
          strategy: 'bayesian',
          history: [{ level: 1, knew: true }],
          finalLevel: undefined,
        },
        firstLessonSummary: undefined,
        firstLessonCardsRated: 3,
      },
      stats: { totalRepetitions: 0, totalTimeMs: 0 },
    });
    expect(lines).toContain('Onboarding: in progress — reached step 7');
    expect(lines).toContain('Placement: unfinished (1 answers)');
    expect(lines).toContain('First lesson: 3 cards rated');
    // Zero-activity stats stay silent instead of shouting "0 reps".
    expect(lines.some((l) => l.startsWith('Study so far'))).toBe(false);
  });

  it('falls back to the self-assessed level when there is no placement test', () => {
    const { lines } = buildSignupNotification({
      ...fullInput,
      onboarding: {
        ...fullInput.onboarding!,
        placementTest: undefined,
        currentLevel: 'upper_intermediate',
      },
    });
    expect(lines).toContain('Self-assessed level: upper intermediate');
  });
});

describe('describePlanChange', () => {
  const free = { plan_id: 'free', plan_name: 'Free', plan_status: 'active' };
  const pro = { plan_id: 'pro', plan_name: 'Pro', plan_status: 'active' };
  const proTrial = { ...pro, plan_status: 'trialing' };
  const proYearly = {
    plan_id: 'pro_yearly',
    plan_name: 'Pro Yearly',
    plan_status: 'active',
  };

  it('classifies free → paid as subscription (or trial)', () => {
    expect(describePlanChange(free, pro)).toBe('New subscription');
    expect(describePlanChange(free, proTrial)).toBe('Trial started');
  });

  it('classifies paid → free as cancellation', () => {
    expect(describePlanChange(pro, free)).toBe('Subscription cancelled');
    // Plan expired entirely (no plan reported) counts as cancelled too.
    expect(describePlanChange(pro, {})).toBe('Subscription cancelled');
  });

  it('classifies paid → other paid as plan change', () => {
    expect(describePlanChange(pro, proYearly)).toBe('Plan changed');
  });

  it('classifies same-plan status flips as status change', () => {
    expect(describePlanChange(proTrial, pro)).toBe('Plan status changed');
    expect(describePlanChange(pro, { ...pro, plan_status: 'past_due' })).toBe(
      'Plan status changed',
    );
  });
});
