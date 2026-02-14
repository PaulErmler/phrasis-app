'use client';

import { AuthUIProvider } from '@daveyplate/better-auth-ui';
import { ThemeProvider } from 'next-themes';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';

import { authClient } from '@/lib/auth-client';

type AuthMessages = Record<string, string>;

type Props = {
  children: ReactNode;
  locale: string;
  messages: Record<string, unknown>;
  timeZone: string;
};

export function Providers({ children, locale, messages, timeZone }: Props) {
  const router = useRouter();
  const authLocalization = (messages.Auth as AuthMessages) || {};


    return (
        <NextIntlClientProvider locale={locale} messages={messages} timeZone={timeZone}>
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
                        router.refresh()
                    }}
                    social={{
                        providers: ["google"],
                    }}
                    Link={Link}
                    localization={authLocalization}
                >
                    {children}
                </AuthUIProvider>
            </ThemeProvider>
        </NextIntlClientProvider>
    )
}
