'use client';

import { AuthUIProvider } from '@daveyplate/better-auth-ui';
import { ThemeProvider } from 'next-themes';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, type ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { toast } from 'sonner';

import { authClient } from '@/lib/auth-client';
import { isTransportErrorMessage } from '@/lib/auth-errors';
import { useIsNativeApp } from '@/hooks/use-native-app';
import { AutumnProvider } from "autumn-js/react";
import { api } from "../convex/_generated/api";
import { useConvex } from "convex/react";

type AuthMessages = Record<string, string>;

type Props = {
  children: ReactNode;
  locale: string;
  messages: Record<string, unknown>;
  timeZone: string;
};

export function AutumnWrapper({ children }: { children: React.ReactNode }) {
  const convex = useConvex();

  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- generated api typing doesn't match AutumnProvider's expected convexApi shape
    <AutumnProvider convex={convex} convexApi={(api as any).autumn}>
      {children}
    </AutumnProvider>
  );
}

export function Providers({ children, locale, messages, timeZone }: Props) {
  const router = useRouter();
  const isNative = useIsNativeApp();
  // Memoized so `authToast` below keeps a stable identity (see its comment).
  const authLocalization = useMemo(() => (messages.Auth as AuthMessages) || {}, [messages]);

  /**
   * better-auth-ui renders error toasts from the raw fetch error, which for a
   * bodiless response is just the status number. Users were seeing a toast
   * reading "404". Swap those for real copy; everything else (wrong password,
   * unverified email, success messages) is already localized and passes
   * through untouched.
   *
   * Memoized: the library keeps this function in the dependency list of the
   * effect behind useAuthData, so a fresh identity per render would refetch in
   * a loop.
   */
  const authToast = useCallback(
    ({ variant = 'default', message }: { variant?: 'default' | 'success' | 'error' | 'info' | 'warning'; message?: string }) => {
      const text = isTransportErrorMessage(message)
        ? authLocalization.REQUEST_FAILED || 'Request failed. Please try again.'
        : message;
      if (variant === 'default') {
        toast(text);
      } else {
        toast[variant](text);
      }
    },
    [authLocalization],
  );

  return (
    <NextIntlClientProvider
      locale={locale}
      messages={messages}
      timeZone={timeZone}
    >
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <AuthUIProvider
          authClient={authClient}
          navigate={router.push}
          replace={router.replace}
          onSessionChange={() => {
            // Clear router cache (protected routes)
            router.refresh();
          }}
          // Redirect-based OAuth breaks inside the store-app WebView (Google
          // blocks it), the shell uses NativeSocialButtons' token flow
          // instead, so the redirect buttons are dropped there.
          social={isNative ? undefined : {
            // 'apple' requires APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID
            // and APPLE_PRIVATE_KEY in the Convex deployment (the client
            // secret is minted from them at runtime, see convex/auth.ts).
            // Set them before deploying this.
            providers: ['google', 'apple'],
          }}
          Link={Link}
          localization={authLocalization}
          toast={authToast}
          // Code-based email verification: after sign-up (or an unverified
          // sign-in) the UI navigates to /auth/email-verification, where
          // entering the emailed 6-digit code verifies AND signs the user
          // in (autoSignInAfterVerification in convex/auth.ts).
          emailVerification={{ otp: true }}
        >
          {children}
        </AuthUIProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  );
}
