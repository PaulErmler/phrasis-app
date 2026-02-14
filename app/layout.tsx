import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { ConvexClientProvider } from "@/components/ConvexClientProvider";
import { Providers } from "./providers";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { PWAInstallGlobal } from "@/components/PWAInstallGlobal";
import { getUserLocale } from "@/i18n/locale";
import { getMessages, getTimeZone } from "next-intl/server";
import { Toaster } from "@/components/ui/sonner";
import { ConsentManager } from "./consent-manager";

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: 'Phrasis',
  description:
    'Master languages with Phrasis. Learn, practice pronunciation, and build fluency in any language.',
  manifest: '/manifest.json',
  icons: {
    icon: [
      { url: "/favicon.svg", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192x192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512x512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: '/apple-touch-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Phrasis',
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

  return (
        <html lang={locale} suppressHydrationWarning>
          <head>
            <link rel="manifest" href="/manifest.json" />
            <meta name="mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-capable" content="yes" />
            <meta name="apple-mobile-web-app-title" content="Phrasis" />
          </head>
          <body
            className={`${geistSans.variable} ${geistMono.variable} antialiased`}
          >
    		<ConsentManager>
    			
            <ServiceWorkerRegistration />
            <PWAInstallGlobal />
            <ConvexClientProvider>
              <Providers locale={locale} messages={messages} timeZone={timeZone}>
                {children}
                <Toaster position="top-center" />
              </Providers>
            </ConvexClientProvider>
          
    		</ConsentManager>
    	</body>
        </html>
      )
}
