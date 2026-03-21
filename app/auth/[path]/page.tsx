import { AuthView } from '@daveyplate/better-auth-ui';
import { authViewPaths } from '@daveyplate/better-auth-ui/server';
import { getMessages } from 'next-intl/server';
import Link from 'next/link';

export const dynamicParams = false;

export function generateStaticParams() {
  return Object.values(authViewPaths).map((path) => ({ path }));
}

function TermsFooter({ authLocalization }: { authLocalization: Record<string, string> }) {
  return (
    <p className="text-center text-xs text-muted-foreground">
      {authLocalization.BY_SIGNING_UP_AGREE || 'By signing up, you agree to our'}{' '}
      <Link href="/legal/agb" className="underline hover:text-foreground" target="_blank">
        {authLocalization.TERMS_AND_CONDITIONS || 'Terms & Conditions'}
      </Link>{' '}
      {authLocalization.ACCEPT_TERMS_AND || 'and the'}{' '}
      <Link href="/legal/privacy" className="underline hover:text-foreground" target="_blank">
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

  return (
    <main className="min-h-screen flex items-center justify-center p-4">
      <div className="w-full max-w-md mx-auto flex justify-center">
        <AuthView
          path={path}
          localization={authLocalization}
          redirectTo="/app/onboarding"
          classNames={{
            base: 'w-full',
            content: 'flex flex-col-reverse',
          }}
          {...(isSignUp && {
            cardFooter: <TermsFooter authLocalization={authLocalization} />,
          })}
        />
      </div>
    </main>
  );
}
