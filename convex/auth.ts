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

export const createAuth = (ctx: GenericCtx<DataModel>) => {
  return betterAuth({
    baseURL: siteUrl,
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      },
    },
    plugins: [
      convex({ authConfig }),
    ],
  });
};
