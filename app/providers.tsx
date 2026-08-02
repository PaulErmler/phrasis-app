'use client';

import { AuthUIProvider } from '@daveyplate/better-auth-ui';
import { ThemeProvider } from 'next-themes';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';

import { authClient } from '@/lib/auth-client';
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
  const authLocalization = (messages.Auth as AuthMessages) || {};

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
          // blocks it) — the shell uses NativeSocialButtons' token flow
          // instead, so the redirect buttons are dropped there.
          social={isNative ? undefined : {
            // 'apple' requires APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID
            // and APPLE_PRIVATE_KEY in the Convex deployment (the client
            // secret is minted from them at runtime, see convex/auth.ts) —
            // set them before deploying this.
            providers: ['google', 'apple'],
          }}
          Link={Link}
          localization={authLocalization}
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
