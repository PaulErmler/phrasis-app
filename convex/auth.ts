import {
  createClient,
  type AuthFunctions,
  type GenericCtx,
} from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { components, internal } from './_generated/api';
import { DataModel } from './_generated/dataModel';
import { query } from './_generated/server';
import { betterAuth } from 'better-auth';
import { SignJWT, importPKCS8 } from 'jose';
import authConfig from './auth.config';
import { upsertUserProfile, deleteUserProfile } from './db/userProfiles';
import { EVENTS, track } from './analytics';

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
      requireEmailVerification: false,
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
      convex({ authConfig }),
    ],
  });
};
