import {
  captureMode,
  escapeHtml,
  SUPPORT_EMAIL,
  type AuthEmailCtx,
} from './authEmails';
import { resend } from './resendClient';
import { rateLimiter } from '../rateLimiter';

/**
 * Internal notification emails to the support inbox (read by Paul) about
 * notable user events: signups (convex/auth.ts onCreate) and subscription
 * changes (usage/helpers.ts syncAllFeatures).
 *
 * Best-effort by design: the send is wrapped in try/catch so a notification
 * can never fail the mutation it rides on (signup, billing sync) — the
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
    ...lines.map((line) => `<p style="margin:0 0 8px;">${escapeHtml(line)}</p>`),
    '</div>',
  ].join('\n');
  const text = lines.join('\n');
  try {
    // Signup notifications sit behind an unauthenticated endpoint, so a
    // global cap keeps mass signups from flooding the inbox 1:1. Dropping
    // is fine — these are best-effort heads-ups, not records.
    const { ok } = await rateLimiter.limit(ctx, 'adminEmail');
    if (!ok) return;
    await resend.sendEmail(ctx, {
      from: FROM,
      to: SUPPORT_EMAIL,
      subject,
      html,
      text,
    });
  } catch (err) {
    console.error(`Admin notification email failed (${subject}):`, err);
  }
}
