'use server';

import { cookies } from 'next/headers';

const LOCALE_COOKIE = 'NEXT_LOCALE';

export type Locale = 'en' | 'de';

const LOCALES: readonly Locale[] = ['en', 'de'];

export async function getUserLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const locale = cookieStore.get(LOCALE_COOKIE)?.value;
  // The cookie is client-controlled and may hold anything (stale app
  // versions, other apps on the domain). An unknown value must fall back to
  // 'en' — it is used to index the static message catalogs in request.tsx.
  return LOCALES.includes(locale as Locale) ? (locale as Locale) : 'en';
}

export async function setUserLocale(locale: Locale): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(LOCALE_COOKIE, locale, {
    path: '/',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    sameSite: 'lax',
  });
}
