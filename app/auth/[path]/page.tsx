import { AuthView } from '@daveyplate/better-auth-ui';
import { authViewPaths } from '@daveyplate/better-auth-ui/server';
import { getMessages } from 'next-intl/server';
import Link from 'next/link';
import { NativeSocialButtons } from '@/components/auth/NativeSocialButtons';
import { SignedInRedirect } from '@/components/auth/SignedInRedirect';

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.values(authViewPaths).map((path) => ({ path }));
}

function TermsFooter({
  authLocalization,
}: {
  authLocalization: Record<string, string>;
}) {
  return (
    <p className="text-center text-xs text-muted-foreground">
      {authLocalization.BY_SIGNING_UP_AGREE ||
        'By signing up, you agree to our'}{' '}
      <Link
        href="/legal/agb"
        className="underline hover:text-foreground"
        target="_blank"
      >
        {authLocalization.TERMS_AND_CONDITIONS || 'Terms & Conditions'}
      </Link>{' '}
      {authLocalization.ACCEPT_TERMS_AND || 'and the'}{' '}
      <Link
        href="/legal/privacy"
        className="underline hover:text-foreground"
        target="_blank"
      >
        {authLocalization.ACCEPT_TERMS_PRIVACY || 'Privacy Policy'}
      </Link>
    </p>
  );
}

export default async function AuthPage({
  params,
}: {
  params: Promise<{ path: string }>;
}) {
  const { path } = await params;
  const messages = await getMessages();
  const authLocalization = (messages.Auth as Record<string, string>) || {};

  const isSignUp = path === 'sign-up';
  const isSignInOrUp = path === 'sign-in' || isSignUp;

  return (
    <main className="min-h-screen flex items-center justify-center p-4 pt-[calc(1rem+var(--safe-top))] pb-[calc(1rem+var(--safe-bottom))]">
      {/* Sign-in/up only: reset-password and email-verification must stay
          reachable with a live session (verification signs the user in
          mid-flow, before its own redirect). */}
      {isSignInOrUp && <SignedInRedirect />}
      <div className="w-full max-w-md mx-auto flex flex-col items-center">
        {/* Brand header */}
        <div className="mb-6 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- static SVG asset */}
          <img src="/icons/icon.svg" alt="" className="h-10 w-10" />
          <span className="text-2xl font-bold tracking-tight">Flexling</span>
        </div>

        <AuthView
          path={path}
          localization={authLocalization}
          redirectTo="/app/onboarding"
          classNames={{
            base: 'w-full',
            content: 'flex flex-col-reverse',
            // The reset-password footer only holds a "Go back" button that
            // calls window.history.back(), a no-op when the page is opened
            // from the emailed reset link in a fresh tab. Hide it; a
            // successful reset redirects to sign-in anyway.
            ...(path === 'reset-password' ? { footer: 'hidden' } : {}),
          }}
          {...(isSignInOrUp && {
            // cardHeader REPLACES the default title block, so it recreates the
            // title and adds the store-shell social buttons directly beneath.
            // Inside the card, above the email form (NativeSocialButtons
            // self-hides on the regular website, leaving just the title).
            cardHeader: (
              <>
                <div className="text-lg font-semibold md:text-xl">
                  {isSignUp
                    ? authLocalization.SIGN_UP || 'Sign Up'
                    : authLocalization.SIGN_IN || 'Sign In'}
                </div>
                <NativeSocialButtons />
              </>
            ),
          })}
          {...(isSignUp && {
            cardFooter: <TermsFooter authLocalization={authLocalization} />,
          })}
        />
      </div>
    </main>
  );
}
