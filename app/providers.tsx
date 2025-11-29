"use client"

import { AuthUIProvider } from "@daveyplate/better-auth-ui"
import { ThemeProvider } from "next-themes"
import Link from "next/link"
import { useRouter } from "next/navigation"
import type { ReactNode } from "react"

import { authClient } from "@/lib/auth-client"
import { NextIntlClientProvider } from "next-intl"

type AuthMessages = Record<string, string>

type Props = {
    children: ReactNode
    locale: string
    messages: Record<string, unknown>
}

export function Providers({ children, locale, messages }: Props) {
    const router = useRouter()
    
    // Extract auth localization from messages
    const authLocalization = (messages.Auth as AuthMessages) || {}

    return (
        <NextIntlClientProvider locale={locale} messages={messages}>
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
                    Link={Link}
                    localization={authLocalization}
                >
                    {children}
                </AuthUIProvider>
            </ThemeProvider>
        </NextIntlClientProvider>
    )
}
