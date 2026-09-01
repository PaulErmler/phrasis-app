import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';
import { ConvexClientProvider } from '@/components/ConvexClientProvider';
import { Providers } from './providers';
import { ServiceWorkerRegistration } from '@/components/ServiceWorkerRegistration';
import { PWAInstallGlobal } from '@/components/PWAInstallGlobal';
import { getUserLocale } from '@/i18n/locale';
import { getMessages, getTimeZone } from 'next-intl/server';
import { Toaster } from '@/components/ui/sonner';
import { PostHogProvider } from '@/components/analytics/PostHogProvider';
import { ConsentBanner } from '@/components/consent/ConsentBanner';
import { OpenAIPixel } from '@/components/analytics/OpenAIPixel';
import { getToken } from '@/lib/auth-server';
import { AutumnWrapper } from './providers';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  // Avoid Chrome “preloaded but not used” when mono rarely paints on first screen.
  preload: false,
});

const siteUrl = process.env.SITE_URL ?? 'https://flexling.com';

export const viewport: Viewport = {
  viewportFit: 'cover',
};

export const metadata: Metadata = {
  title: {
    default: 'Flexling',
    template: '%s | Flexling',
  },
  description:
    'Learn a language the way you learned your first. Absorb words in sentences that actually matter to you — type them, import them, or ask AI to create cards.',
  metadataBase: new URL(siteUrl),
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '192x192', type: 'image/png' },
    ],
  },
  openGraph: {
    title: 'Flexling',
    description:
      'Learn a language the way you learned your first. Absorb words in sentences that actually matter to you. Free to start.',
    url: siteUrl,
    siteName: 'Flexling',
    type: 'website',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary',
    title: 'Flexling',
    description:
      'Learn a language the way you learned your first. Absorb words in sentences that actually matter to you. Free to start.',
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Flexling',
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getUserLocale();
  const messages = await getMessages();
  const timeZone = await getTimeZone();
  const initialToken = await getToken();

  return (
    <html lang={locale} data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-status-bar-style"
          content="black-translucent"
        />
        <meta name="apple-mobile-web-app-title" content="Flexling" />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {/*
          PostHog sits outermost so `usePostHog()` resolves everywhere below,
          including inside the Convex and intl providers. It writes nothing to
          the device until the banner is answered. See lib/posthog/client.ts.
        */}
        <PostHogProvider>
          <ServiceWorkerRegistration />
          <PWAInstallGlobal />
          <ConvexClientProvider initialToken={initialToken}>
            <Providers locale={locale} messages={messages} timeZone={timeZone}>
              <AutumnWrapper>{children}</AutumnWrapper>
              <Toaster position="top-center" />
              {/* Inside NextIntlClientProvider. The banner is translated. */}
              <ConsentBanner />
              {/* Root, not /app: the ad click lands on the marketing pages,
                  and the pixel only reads its click id from that first URL. */}
              <OpenAIPixel />
            </Providers>
          </ConvexClientProvider>
        </PostHogProvider>
      </body>
    </html>
  );
}
