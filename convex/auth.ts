import {
  createClient,
  type AuthFunctions,
  type GenericCtx,
} from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { requireRunMutationCtx } from '@convex-dev/better-auth/utils';
import { components, internal } from './_generated/api';
import { DataModel } from './_generated/dataModel';
import { query } from './_generated/server';
import { betterAuth } from 'better-auth';
import { SignJWT, importPKCS8 } from 'jose';
import authConfig from './auth.config';
import { emailOTP } from 'better-auth/plugins';
import { upsertUserProfile, deleteUserProfile } from './db/userProfiles';
import { EVENTS, track } from './analytics';
import {
  sendResetPasswordEmail,
  sendVerificationOtpEmail,
  type AuthEmailCtx,
} from './lib/authEmails';
import { sendAdminNotificationEmail } from './lib/adminEmails';
import {
  WELCOME_EMAIL_DELAY_MS,
  WELCOME_EMAIL_JITTER_MS,
} from './lib/welcomeEmail';
import { rateLimiter } from './rateLimiter';

const siteUrl = process.env.SITE_URL;
if (!siteUrl) throw new Error('Missing required Convex environment variable: SITE_URL');

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
// User triggers keep the app-owned `userProfiles` mirror (admin dashboard
// user list/search) in sync with the component's user table.
// Cast breaks the type-level circularity: internal.auth's type includes the
// triggersApi() exports below, which are derived from authComponent itself.
const authFunctions = internal.auth as unknown as AuthFunctions;

export const authComponent = createClient<DataModel>(components.betterAuth, {
  authFunctions,
  triggers: {
    user: {
      onCreate: async (ctx, doc) => {
        await upsertUserProfile(ctx, doc);
        // Top of every funnel. `doc._id` is the Better Auth user id — the same
        // string the client identifies with and Autumn bills, so this event
        // lands on the person the rest of the timeline accrues to. No email or
        // name here: person data reaches PostHog only via the consent-gated
        // client-side identify.
        await track(ctx, doc._id, EVENTS.USER_SIGNED_UP);
        // Personal founder welcome email, ~1 day in (jittered so it doesn't
        // land at exactly signup + 24h). Enqueued here so it's atomic with
        // user creation; features/welcomeEmail.ts re-checks at send time
        // that the account still exists and got verified.
        const jitter = (Math.random() * 2 - 1) * WELCOME_EMAIL_JITTER_MS;
        await ctx.scheduler.runAfter(
          WELCOME_EMAIL_DELAY_MS + jitter,
          internal.features.welcomeEmail.sendScheduled,
          { userId: doc._id },
        );
        // Heads-up to the support inbox. Fires at account creation — for
        // email+password signups that's before verification, so a few of
        // these may never activate.
        await sendAdminNotificationEmail(ctx, {
          subject: `New signup: ${doc.email}`,
          lines: [
            `Name: ${doc.name || '(none)'}`,
            `Email: ${doc.email}`,
          ],
        });
      },
      onUpdate: async (ctx, newDoc) => {
        await upsertUserProfile(ctx, newDoc);
      },
      onDelete: async (ctx, doc) => {
        await deleteUserProfile(ctx, doc._id);
      },
    },
  },
});

export const { onCreate, onUpdate, onDelete } = authComponent.triggersApi();

// Use the safe (non-throwing) version so the AuthBoundary's ErrorBoundary
// doesn't trigger during transient JWT refresh windows. True logout is
// still handled by AuthBoundary's useEffect via useConvexAuth().
export const getAuthUser = query({
  args: {},
  handler: async (ctx) => {
    return (await authComponent.safeGetAuthUser(ctx)) ?? null;
  },
});

/**
 * Apple's "client secret" is a short-lived ES256 JWT signed with the Sign in
 * with Apple private key — generated on demand per the Better Auth docs
 * (https://better-auth.com/docs/authentication/apple) so no static token has
 * to be rotated every 6 months. Cached module-level and re-minted well before
 * expiry; signed for 180 days (below Apple's six-month cap).
 *
 * Env: APPLE_CLIENT_ID (Services ID), APPLE_TEAM_ID, APPLE_KEY_ID,
 * APPLE_PRIVATE_KEY (the .p8 private key contents).
 */
let cachedAppleSecret: { jwt: string; expiresAt: number } | null = null;

async function appleClientSecret(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAppleSecret && cachedAppleSecret.expiresAt - now > 60 * 60 * 24) {
    return cachedAppleSecret.jwt;
  }
  // Support keys pasted with literal "\n" escapes as well as real newlines.
  const privateKey = (process.env.APPLE_PRIVATE_KEY as string).replace(/\\n/g, '\n');
  const key = await importPKCS8(privateKey, 'ES256');
  const expiresAt = now + 180 * 24 * 60 * 60;
  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: 'ES256', kid: process.env.APPLE_KEY_ID as string })
    .setIssuer(process.env.APPLE_TEAM_ID as string)
    .setSubject(process.env.APPLE_CLIENT_ID as string)
    .setAudience('https://appleid.apple.com')
    .setIssuedAt(now)
    .setExpirationTime(expiresAt)
    .sign(key);
  cachedAppleSecret = { jwt, expiresAt };
  return jwt;
}

/**
 * Rate gate for the unauthenticated transactional auth emails (verification
 * codes + password-reset links): per-recipient bucket first, then the
 * global backstop — in that order, so an address already at its own limit
 * doesn't burn global tokens. Callers silently skip the send on false; the
 * callbacks must never throw, since a 500 there would leak whether the
 * account exists.
 */
async function allowAuthEmail(
  ctx: AuthEmailCtx,
  email: string,
): Promise<boolean> {
  const perAddress = await rateLimiter.limit(ctx, 'authEmail', {
    key: email.toLowerCase(),
  });
  if (!perAddress.ok) return false;
  const global = await rateLimiter.limit(ctx, 'authEmailGlobal');
  return global.ok;
}

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: siteUrl,
    // Apple delivers the sign-in callback via a form POST from its own
    // origin, which Better Auth rejects unless the origin is trusted
    // (https://better-auth.com/docs/authentication/apple).
    trustedOrigins: ['https://appleid.apple.com'],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      // Unverified accounts cannot sign in (403 EMAIL_NOT_VERIFIED, handled
      // by better-auth-ui); this also turns on Better Auth's built-in
      // email-enumeration protection for sign-up.
      requireEmailVerification: true,
      // A password reset logs every other device/session out.
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        // The callback runs inside the component's HTTP action (action
        // ctx, no db) — requireRunMutationCtx accepts mutation OR action
        // ctx and only rejects the query ctx createAuth can also receive.
        const runCtx = requireRunMutationCtx(ctx);
        if (!(await allowAuthEmail(runCtx, user.email))) return;
        await sendResetPasswordEmail(runCtx, { to: user.email, url });
      },
    },
    // Verification is CODE-based: no sendVerificationEmail here — the
    // emailOTP plugin below (overrideDefaultEmailVerification) injects an
    // OTP sender in its place, so sign-up and unverified sign-ins email a
    // 6-digit code instead of a link.
    emailVerification: {
      sendOnSignUp: true,
      // Re-send the code on every unverified sign-in attempt, so a user
      // who lost the first email can just try logging in. Rate-limited in
      // sendVerificationOTP below.
      sendOnSignIn: true,
      // Submitting the code both verifies and signs the user in
      // (better-auth-ui's /auth/email-verification form then redirects to
      // the AuthView redirectTo, /app/onboarding).
      autoSignInAfterVerification: true,
    },
    // Account deletion is deliberately NOT self-serve (`user.deleteUser`
    // stays disabled): deleting only the Better Auth user would orphan all
    // app data and the Autumn/Stripe subscription. Deletion goes through
    // features/accountDeletion.ts (support request, manual fulfillment).
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      },
      // Sign in with Apple — required by App Store Guideline 4.8 because
      // Google sign-in is offered. Env-gated so deployments without the
      // Apple credentials keep working unchanged. The async form lets the
      // client secret be minted on demand (see appleClientSecret) instead of
      // storing a static JWT that expires every 6 months.
      ...(process.env.APPLE_CLIENT_ID &&
      process.env.APPLE_TEAM_ID &&
      process.env.APPLE_KEY_ID &&
      process.env.APPLE_PRIVATE_KEY
        ? {
          apple: async () => {
            // Better Auth resolves ALL providers together — if this throws,
            // Google/email sign-in break too. A bad Apple key must only
            // disable Apple (returning null skips the provider).
            try {
              return {
                clientId: process.env.APPLE_CLIENT_ID as string,
                clientSecret: await appleClientSecret(),
                // Audience of identity tokens minted by the native iOS app
                // (the Capacitor shell signs in with an idToken, not a
                // browser redirect).
                appBundleIdentifier:
                    process.env.APPLE_APP_BUNDLE_IDENTIFIER ?? 'com.flexling.app',
              };
            } catch (err) {
              console.error(
                'Sign in with Apple disabled: client secret generation failed ' +
                  '(check APPLE_PRIVATE_KEY formatting):',
                err,
              );
              // `enabled: false` makes Better Auth skip the provider.
              return { enabled: false, clientId: '', clientSecret: '' };
            }
          },
        }
        : {}),
    },
    plugins: [
      // Code-based email verification: replaces the default link-based
      // verification email with a 6-digit OTP (5-minute expiry). The
      // /auth/email-verification form submits it via
      // authClient.emailOtp.verifyEmail.
      emailOTP({
        overrideDefaultEmailVerification: true,
        // The plugin also exposes passwordless OTP sign-in endpoints;
        // keep them from ever creating accounts.
        disableSignUp: true,
        // Re-sends deliver the SAME unexpired code instead of rotating it.
        // The plugin stores a fresh OTP BEFORE calling sendVerificationOTP,
        // so with the default 'rotate' a rate-limited (silently dropped)
        // send would invalidate the code the user already received.
        resendStrategy: 'reuse',
        // Encrypt codes at rest (with the Better Auth secret) so they
        // aren't readable via dashboard/DB access. Must stay 'encrypted',
        // NOT 'hashed': tryReuseOTP can't recover a hashed code and
        // silently falls back to rotating, reintroducing the dropped-send
        // invalidation problem above.
        storeOTP: 'encrypted',
        async sendVerificationOTP({ email, otp, type }) {
          // Only email verification is offered in the UI. The plugin's
          // other OTP types (passwordless sign-in, OTP password reset)
          // are unused — never email codes for them.
          if (type !== 'email-verification') return;
          const runCtx = requireRunMutationCtx(ctx);
          if (!(await allowAuthEmail(runCtx, email))) return;
          await sendVerificationOtpEmail(runCtx, { to: email, otp });
        },
      }),
      convex({ authConfig }),
    ],
  });
};
