'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';
import { useIsNativeApp } from '@/hooks/use-native-app';
import { nativePlatform } from '@/lib/native';

/**
 * Social sign-in for the Capacitor store-app shell.
 *
 * Google rejects OAuth redirects inside WebViews (`disallowed_useragent`), so
 * the browser-redirect buttons from better-auth-ui are hidden in the shell
 * (see AuthUIProvider in app/providers.tsx) and replaced by these: the
 * @capgo/capacitor-social-login plugin obtains an ID token natively and
 * Better Auth signs in with the token directly, no redirect involved.
 *
 * Renders nothing on the regular website.
 *
 * The Google token is requested with the WEB client id as audience
 * (NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID) so the backend's existing
 * GOOGLE_CLIENT_ID verification accepts it.
 */

type NativeProvider = 'google' | 'apple';

async function nativeSocialLogin(provider: NativeProvider): Promise<{
  idToken: string;
  accessToken?: string;
}> {
  const { SocialLogin } = await import('@capgo/capacitor-social-login');
  await SocialLogin.initialize({
    google: {
      webClientId: process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID,
      iOSClientId: process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID,
      mode: 'online',
    },
    apple: {},
  });
  const res = await SocialLogin.login({
    provider,
    options: {
      scopes: provider === 'google' ? ['email', 'profile'] : ['email', 'name'],
    },
  });
  const result = res.result as {
    idToken?: string | null;
    accessToken?: { token?: string } | null;
  };
  if (!result?.idToken) throw new Error(`${provider} login returned no idToken`);
  return {
    idToken: result.idToken,
    accessToken: result.accessToken?.token ?? undefined,
  };
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.17 3.57-8.81Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.93-2.91l-3.87-3c-1.07.72-2.44 1.14-4.06 1.14-3.12 0-5.77-2.11-6.71-4.95H1.29v3.09A12 12 0 0 0 12 24Z" />
      <path fill="#FBBC05" d="M5.29 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.29a12 12 0 0 0 0 10.74l4-3.09Z" />
      <path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.59 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.29 6.63l4 3.09C6.23 6.88 8.88 4.77 12 4.77Z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 fill-current" aria-hidden>
      <path d="M16.72 12.84c.03 3.18 2.79 4.24 2.82 4.25-.02.08-.44 1.51-1.45 2.99-.88 1.28-1.79 2.55-3.22 2.58-1.41.03-1.86-.83-3.47-.83-1.6 0-2.1.8-3.43.86-1.38.05-2.44-1.38-3.32-2.65-1.81-2.61-3.19-7.37-1.34-10.58A5.15 5.15 0 0 1 7.66 6.8c1.36-.03 2.64.91 3.47.91.83 0 2.39-1.13 4.03-.96.68.03 2.6.28 3.83 2.08-.1.06-2.29 1.33-2.27 4.01ZM14.08 4.99c.73-.89 1.23-2.12 1.09-3.35-1.06.04-2.33.7-3.09 1.59-.68.78-1.27 2.04-1.11 3.24 1.18.09 2.38-.6 3.11-1.48Z" />
    </svg>
  );
}

export function NativeSocialButtons() {
  const isNative = useIsNativeApp();
  const router = useRouter();
  const t = useTranslations('Auth');
  const [busy, setBusy] = useState<NativeProvider | null>(null);

  if (!isNative) return null;

  const signIn = async (provider: NativeProvider) => {
    setBusy(provider);
    try {
      const { idToken, accessToken } = await nativeSocialLogin(provider);
      const { error } = await authClient.signIn.social({
        provider,
        idToken: { token: idToken, accessToken },
      });
      if (error) throw new Error(error.message ?? 'signIn.social failed');
      router.push('/app/onboarding');
      router.refresh();
    } catch (err) {
      console.error(`Native ${provider} sign-in failed:`, err);
      toast.error(t('SOCIAL_SIGN_IN_FAILED'));
      setBusy(null);
    }
  };

  return (
    <div className="w-full flex flex-col gap-2 mt-4">
      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
        disabled={busy !== null}
        onClick={() => signIn('google')}
      >
        {busy === 'google' ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleMark />}
        {t('SIGN_IN_WITH_GOOGLE')}
      </Button>
      {/* Apple's native sheet only exists on iOS; Android keeps Google + email. */}
      {nativePlatform() === 'ios' && (
        <Button
          type="button"
          variant="outline"
          className="w-full gap-2"
          disabled={busy !== null}
          onClick={() => signIn('apple')}
        >
          {busy === 'apple' ? <Loader2 className="h-4 w-4 animate-spin" /> : <AppleMark />}
          {t('SIGN_IN_WITH_APPLE')}
        </Button>
      )}
    </div>
  );
}
