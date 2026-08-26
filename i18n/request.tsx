import { getRequestConfig } from 'next-intl/server';
import { getUserLocale, type Locale } from './locale';
import en from '../messages/en.json';
import de from '../messages/de.json';

const catalogs = { en, de } satisfies Record<Locale, typeof en>;

export default getRequestConfig(async () => {
  const locale = await getUserLocale();

  const [authMessages, landingMessages] = await Promise.all([
    import(`../messages/authentication/${locale}.json`)
      .then((m) => m.default)
      .catch(() => ({})),
    import(`../messages/landing/${locale}.json`)
      .then((m) => m.default)
      .catch(() => ({})),
  ]);

  return {
    locale,
    messages: {
      ...catalogs[locale],
      ...(Object.keys(authMessages).length > 0 && { Auth: authMessages.Auth }),
      ...(Object.keys(landingMessages).length > 0 && { LandingPage: landingMessages }),
    },
    timeZone: 'UTC',
  };
});
