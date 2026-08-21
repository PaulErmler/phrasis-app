import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { convexClient } from '@convex-dev/better-auth/client/plugins';

import { reportAuthRequestFailure } from '@/lib/auth-errors';

export const authClient = createAuthClient({
  // emailOTPClient provides authClient.emailOtp.verifyEmail. Used by the
  // /auth/email-verification code form (see the emailOTP plugin in
  // convex/auth.ts).
  plugins: [emailOTPClient(), convexClient()],
  fetchOptions: {
    // Better Auth lifts this hook into a fetch plugin rather than passing it
    // as a base option (client/config.mjs), so per-call `fetchOptions`. Every
    // better-auth-ui request sends `{ throw: true }`. Cannot displace it.
    // Runs for every non-2xx auth response; see lib/auth-errors.ts for why the
    // reported properties are the ones that identify the failure.
    onError: (context) => reportAuthRequestFailure(context),
  },
});
