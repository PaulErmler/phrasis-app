import { Resend } from '@convex-dev/resend';
import { components } from '../_generated/api';

// Shared Resend client. One component instance for all outbound mail
// (auth emails in lib/authEmails.ts, account-deletion requests in
// features/accountDeletion.ts).
// testMode would silently swallow mail to real addresses. The component
// only delivers to Resend test inboxes while it's on.
export const resend: Resend = new Resend(components.resend, {
  testMode: false,
});
