import type { RunMutationCtx } from '@convex-dev/better-auth/utils';
import { internal } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import { emailEnvLabel, formatEmailEnvLabel, withEmailEnvSubject } from './emailEnv';
import { resend } from './resendClient';

/**
 * Transactional auth emails (email verification + password reset), sent by
 * the Better Auth callbacks in convex/auth.ts. English-only.
 *
 * E2E capture mode: while the deployment has `E2E_TEST_HOOKS=1` (set for
 * the duration of a Playwright run by e2e/global-setup.ts), emails are
 * written to the `testAuthEmails` table INSTEAD of being sent, so Playwright
 * can use the codes/links (features/authEmailTesting.ts) and the fake
 * `@flexling.com` signup addresses never turn into real bounces.
 */

export const SUPPORT_EMAIL = 'support@flexling.com';
const FROM = `Flexling <${SUPPORT_EMAIL}>`;
// Emails need absolute asset URLs regardless of deployment; the production
// icon doubles as the logo.
const LOGO_URL = 'https://flexling.com/icons/icon-192x192.png';
// --primary from app/globals.css (oklch(0.7162 0.119 217.31)) as sRGB hex.
// Email clients need literal colors, not CSS variables.
const BRAND_COLOR = '#2bb5d4';

export type AuthEmailKind = 'verify' | 'reset';

export interface AuthEmailCopy {
  subject: string;
  heading: string;
  body: string;
  /** CTA button label. Link emails only. */
  cta?: string;
}

export const AUTH_EMAIL_COPY: Record<AuthEmailKind, AuthEmailCopy> = {
  // Email verification is code-based (Better Auth emailOTP plugin with
  // overrideDefaultEmailVerification): the user types this code into the
  // /auth/email-verification form, which then signs them in directly.
  // The code is appended to the subject at send time so it can be copied
  // straight from the inbox list / notification without opening the email.
  verify: {
    subject: 'Your Flexling verification code',
    heading: 'Verify your email address',
    body:
      'Welcome to Flexling! Enter this code in the app to confirm your ' +
      "email address. It expires in 5 minutes. If you didn't create an " +
      'account, you can safely ignore this email.',
  },
  reset: {
    subject: 'Reset your Flexling password',
    heading: 'Reset your password',
    body:
      'We received a request to reset the password for your Flexling ' +
      "account. The link below is valid for 1 hour. If you didn't request " +
      'this, you can safely ignore this email — your password stays ' +
      'unchanged.',
    cta: 'Reset password',
  },
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

// All styles inline. Email clients strip <style> blocks. Simple div layout
// (no tables) renders fine in Gmail/Apple Mail/Outlook.com for a
// single-column card.
const bodyStyle = 'color:#4b5563;font-size:14px;line-height:1.6;margin:0 0 20px;';
const headingStyle = 'color:#111827;font-size:20px;font-weight:700;margin:0 0 12px;';
const buttonStyle =
  `background:${BRAND_COLOR};border-radius:8px;color:#ffffff;display:inline-block;` +
  'font-size:14px;font-weight:600;padding:12px 24px;text-decoration:none;';

function emailEnvBanner(): string {
  const label = emailEnvLabel();
  if (!label) return '';
  const display = formatEmailEnvLabel(label);
  return (
    `<p style="background:#fef3c7;border-radius:8px;color:#92400e;font-size:12px;` +
    `font-weight:600;letter-spacing:0.02em;margin:0 0 20px;padding:8px 12px;` +
    `text-align:center;">[${escapeHtml(display)}]</p>`
  );
}

function emailShell(content: string): string {
  return `
<div style="background:#f3f4f6;margin:0;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="background:#ffffff;border-radius:12px;margin:0 auto;max-width:480px;padding:32px;">
    <img src="${LOGO_URL}" width="48" height="48" alt="Flexling" style="border-radius:10px;display:block;margin:0 0 24px;">
    ${emailEnvBanner()}
    ${content}
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:28px 0;">
    <p style="color:#9ca3af;font-size:12px;margin:0;">
      Flexling · <a href="mailto:${SUPPORT_EMAIL}" style="color:#9ca3af;">${SUPPORT_EMAIL}</a>
    </p>
  </div>
</div>
`.trim();
}

export function renderAuthEmail(
  copy: AuthEmailCopy,
  url: string,
): { html: string; text: string } {
  const html = emailShell(
    [
      `<h1 style="${headingStyle}">${escapeHtml(copy.heading)}</h1>`,
      `<p style="${bodyStyle}">${escapeHtml(copy.body)}</p>`,
      `<p style="margin:0 0 24px;"><a href="${escapeHtml(url)}" style="${buttonStyle}">${escapeHtml(copy.cta ?? 'Open link')}</a></p>`,
      `<p style="color:#9ca3af;font-size:12px;line-height:1.6;margin:0;">`,
      `  If the button doesn't work, copy this link into your browser:<br>`,
      `  <a href="${escapeHtml(url)}" style="color:${BRAND_COLOR};word-break:break-all;">${escapeHtml(url)}</a>`,
      `</p>`,
    ].join('\n'),
  );

  const text = [
    copy.heading,
    '',
    copy.body,
    '',
    `${copy.cta ?? 'Open link'}: ${url}`,
    '',
    `Flexling · ${SUPPORT_EMAIL}`,
  ].join('\n');

  return { html, text };
}

/**
 * The verification-code email: same card layout as renderAuthEmail, but
 * instead of a CTA button the code is displayed large in a monospace box.
 * The code sits alone in its own element with plain selectable text (no
 * per-digit markup), so a tap/triple-click selects exactly the six digits.
 */
export function renderOtpEmail(
  copy: AuthEmailCopy,
  otp: string,
): { html: string; text: string } {
  const codeBox =
    `<p style="background:#f3f4f6;border-radius:8px;color:#111827;` +
    "font-family:'SF Mono',SFMono-Regular,Consolas,Menlo,monospace;" +
    'font-size:28px;font-weight:700;letter-spacing:4px;margin:0;' +
    `padding:16px 24px;text-align:center;">${escapeHtml(otp)}</p>`;
  const html = emailShell(
    [
      `<h1 style="${headingStyle}">${escapeHtml(copy.heading)}</h1>`,
      `<p style="${bodyStyle}">${escapeHtml(copy.body)}</p>`,
      codeBox,
    ].join('\n'),
  );

  const text = [
    copy.heading,
    '',
    copy.body,
    '',
    otp,
    '',
    `Flexling · ${SUPPORT_EMAIL}`,
  ].join('\n');

  return { html, text };
}

// The Better Auth callbacks run inside the component's HTTP action, so the
// ctx is a mutation OR action ctx. Everything below must go through
// runMutation-style APIs, never ctx.db (see requireRunMutationCtx in
// convex/auth.ts).
export type AuthEmailCtx = RunMutationCtx<DataModel>;

export const captureMode = () => process.env.E2E_TEST_HOOKS === '1';

/**
 * Playwright fixture addresses, e.g.
 * `e2e-billing-1770000000000-a1b2c3d4e5f6@flexling.com`.
 *
 * Kept deliberately tight (prefix + epoch ms + 12 hex chars) so a real user who
 * happens to pick an `e2e-…` local part is never silently dropped. Must stay in
 * sync with the two generators. `generateCredentials` in e2e/auth.setup.ts and
 * `signUpFreshUser` in e2e/helpers.ts; convex/tests/lib/authEmails.test.ts pins
 * the shape.
 */
const E2E_FIXTURE_ADDRESS_RE =
  /^e2e-[a-z0-9-]+-\d+-[0-9a-f]{12}@flexling\.com$/i;

/**
 * True for a Playwright fixture signup address.
 *
 * `captureMode()` cannot cover these on its own: it is evaluated at SEND time,
 * and the deferred mails (welcome ~24h, signup notification ~20min) fire long
 * after e2e/global-teardown.ts has removed `E2E_TEST_HOOKS`. Without this
 * filter Resend would attempt real delivery to a mailbox that does not exist on
 * our own sending domain. One hard bounce per fixture user per run, degrading
 * the reputation of the domain that also carries production transactional mail.
 *
 * Unlike the env flag, this holds whenever the email fires.
 */
export function isE2EFixtureAddress(email: string): boolean {
  return E2E_FIXTURE_ADDRESS_RE.test(email.trim());
}

/**
 * Verification code (Better Auth emailOTP plugin). The user types the code
 * into /auth/email-verification, which verifies AND signs them in
 * (autoSignInAfterVerification).
 */
export async function sendVerificationOtpEmail(
  ctx: AuthEmailCtx,
  { to, otp }: { to: string; otp: string },
): Promise<void> {
  const copy = AUTH_EMAIL_COPY.verify;
  // Code in the subject → copiable from the inbox list / notification.
  // Non-prod deployments prefix with [Staging] / [Test] via EMAIL_ENV.
  const subject = withEmailEnvSubject(`${copy.subject}: ${otp}`);
  if (captureMode()) {
    await ctx.runMutation(internal.features.authEmailTesting.captureAuthEmail, {
      email: to.toLowerCase(),
      kind: 'verify',
      otp,
      subject,
    });
    return;
  }
  const { html, text } = renderOtpEmail(copy, otp);
  await resend.sendEmail(ctx, { from: FROM, to, subject, html, text });
}

export async function sendResetPasswordEmail(
  ctx: AuthEmailCtx,
  { to, url }: { to: string; url: string },
): Promise<void> {
  const copy = AUTH_EMAIL_COPY.reset;
  const subject = withEmailEnvSubject(copy.subject);
  if (captureMode()) {
    await ctx.runMutation(internal.features.authEmailTesting.captureAuthEmail, {
      email: to.toLowerCase(),
      kind: 'reset',
      url,
      subject,
    });
    return;
  }
  const { html, text } = renderAuthEmail(copy, url);
  await resend.sendEmail(ctx, { from: FROM, to, subject, html, text });
}
