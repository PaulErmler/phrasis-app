import { internal } from '../_generated/api';
import {
  captureMode,
  isE2EFixtureAddress,
  escapeHtml,
  SUPPORT_EMAIL,
  type AuthEmailCtx,
} from './authEmails';
import { resend } from './resendClient';

/**
 * Personal founder welcome email, scheduled ~1 day after signup by the user
 * onCreate trigger in convex/auth.ts (send-time checks live in
 * features/welcomeEmail.ts). English-only, like the auth emails.
 *
 * Deliberately does NOT use the branded emailShell from authEmails.ts: no
 * logo, no card, no button. Plain founder emails read like a direct message
 * and get far higher reply rates than designed HTML — and replies are the
 * whole point of this email.
 */

// Personal display name, replies land in the support inbox Paul answers from.
const FROM = `Paul from Flexling <${SUPPORT_EMAIL}>`;

export const WELCOME_EMAIL_SUBJECT = 'Welcome to Flexling!';

/** Base delay between signup (user onCreate) and the welcome email. */
export const WELCOME_EMAIL_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * Random ±jitter added to the base delay, so the email doesn't land at
 * exactly the signup time + 24h — that timing reads as automated, and this
 * email is meant to feel personal.
 */
export const WELCOME_EMAIL_JITTER_MS = 3 * 60 * 60 * 1000;

export function renderWelcomeEmail(name?: string): {
  subject: string;
  html: string;
  text: string;
} {
  // First name only — "Hi Anna," not "Hi Anna Schmidt,". OAuth-less signups
  // can have an empty name; fall back to a bare greeting.
  const firstName = name?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hi ${firstName},` : 'Hi,';
  const paragraphs = [
    'Thank you for trying out Flexling! How is it going?',
    "If there's anything I can help with or that isn't working for you, " +
      "please let me know :) I'm constantly improving the app and write " +
      "personally with most of my users — so please don't hesitate to just " +
      "reply if there's anything at all.",
  ];
  const signoff = ['Warm wishes', 'Paul', 'Founder of Flexling'];

  const pStyle = 'margin:0 0 16px;';
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#222222;">',
    `<p style="${pStyle}">${escapeHtml(greeting)}</p>`,
    ...paragraphs.map((p) => `<p style="${pStyle}">${escapeHtml(p)}</p>`),
    `<p style="margin:0;">${signoff.map(escapeHtml).join('<br>')}</p>`,
    '</div>',
  ].join('\n');

  const text = [greeting, '', paragraphs.join('\n\n'), '', signoff.join('\n')].join(
    '\n',
  );

  return { subject: WELCOME_EMAIL_SUBJECT, html, text };
}

export async function sendWelcomeEmail(
  ctx: AuthEmailCtx,
  { to, name }: { to: string; name?: string },
): Promise<void> {
  // Fires ~24h after signup, long after the e2e run (and its E2E_TEST_HOOKS
  // flag) is gone, so the capture branch below cannot catch fixture users.
  if (isE2EFixtureAddress(to)) return;
  const { subject, html, text } = renderWelcomeEmail(name);
  if (captureMode()) {
    await ctx.runMutation(internal.features.authEmailTesting.captureAuthEmail, {
      email: to.toLowerCase(),
      kind: 'welcome',
      subject,
    });
    return;
  }
  await resend.sendEmail(ctx, { from: FROM, to, subject, html, text });
}
