'use client';

import { NextIntlClientProvider } from 'next-intl';
import { IntlErrorCode, type IntlError } from 'next-intl';
import { useCallback, type ReactNode } from 'react';

/**
 * NextIntlClientProvider with an explicit, picked message subset (see
 * i18n/namespaces.ts). The error handlers live here because functions can't
 * cross the server→client boundary.
 *
 * A MISSING_MESSAGE whose top-level namespace is absent from the provided
 * subset means a pick-list regression (a component moved/added without
 * registering its namespace) — that throws in development so it can't be
 * missed. Ordinary missing keys (e.g. a locale gap) only log, as before.
 */
export function ScopedIntlProvider({
  locale,
  timeZone,
  messages,
  children,
}: {
  locale: string;
  timeZone: string;
  messages: Record<string, unknown>;
  children: ReactNode;
}) {
  const onError = useCallback(
    (error: IntlError) => {
      if (error.code === IntlErrorCode.MISSING_MESSAGE) {
        const match = /Could not resolve `([^`.]+)/.exec(error.message);
        const namespace = match?.[1];
        if (
          namespace &&
          !(namespace in messages) &&
          process.env.NODE_ENV !== 'production'
        ) {
          throw new Error(
            `i18n namespace "${namespace}" is not shipped to this route's ` +
              'client provider — register it in i18n/namespaces.ts. ' +
              `(${error.message})`,
          );
        }
      }
      console.error(error);
    },
    [messages],
  );

  const getMessageFallback = useCallback(
    ({ namespace, key }: { namespace?: string; key: string }) =>
      `«${[namespace, key].filter(Boolean).join('.')}»`,
    [],
  );

  return (
    <NextIntlClientProvider
      locale={locale}
      timeZone={timeZone}
      messages={messages as never}
      onError={onError}
      getMessageFallback={getMessageFallback}
    >
      {children}
    </NextIntlClientProvider>
  );
}
