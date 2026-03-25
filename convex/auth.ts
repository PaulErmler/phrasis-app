import { createClient, type GenericCtx } from '@convex-dev/better-auth';
import { convex } from '@convex-dev/better-auth/plugins';
import { components } from './_generated/api';
import { DataModel } from './_generated/dataModel';
import { query } from './_generated/server';
import { betterAuth } from 'better-auth';
import authConfig from './auth.config';

const siteUrl = process.env.SITE_URL;
if (!siteUrl) throw new Error('Missing required Convex environment variable: SITE_URL');

// The component client has methods needed for integrating Convex with Better Auth,
// as well as helper methods for general use.
export const authComponent = createClient<DataModel>(components.betterAuth);

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
    // emailAndPassword: {
    //   enabled: true,
    //   requireEmailVerification: false,
    // },
    socialProviders: {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID as string,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET as string,
      },
    },
    plugins: [
      convex({
        authConfig,
        jwt: { expirationSeconds: 900 }, 
        jwksRotateOnTokenGenerationError: true,
      }),
    ],
  });
};
