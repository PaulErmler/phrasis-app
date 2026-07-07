import { getMessages, getTimeZone } from 'next-intl/server';
import type { ReactNode } from 'react';
import { getUserLocale } from '@/i18n/locale';
import { pickMessages } from '@/i18n/namespaces';
import { ScopedIntlProvider } from './ScopedIntlProvider';

/**
 * Server wrapper: loads the request's messages once and forwards only the
 * given namespaces to a client-side provider. Use one per route area
 * (app shell, onboarding, landing) — nested providers replace the parent's
 * messages, so the list must be self-sufficient (include the shared set).
 */
export async function ScopedMessages({
  namespaces,
  children,
}: {
  namespaces: ReadonlyArray<string>;
  children: ReactNode;
}) {
  const [locale, timeZone, messages] = await Promise.all([
    getUserLocale(),
    getTimeZone(),
    getMessages(),
  ]);

  return (
    <ScopedIntlProvider
      locale={locale}
      timeZone={timeZone}
      messages={pickMessages(messages, namespaces)}
    >
      {children}
    </ScopedIntlProvider>
  );
}
