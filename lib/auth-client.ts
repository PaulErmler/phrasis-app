import { createAuthClient } from 'better-auth/react';
import { emailOTPClient } from 'better-auth/client/plugins';
import { convexClient } from '@convex-dev/better-auth/client/plugins';

export const authClient = createAuthClient({
  // emailOTPClient provides authClient.emailOtp.verifyEmail — used by the
  // /auth/email-verification code form (see the emailOTP plugin in
  // convex/auth.ts).
  plugins: [emailOTPClient(), convexClient()],
});
