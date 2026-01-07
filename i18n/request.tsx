import { getRequestConfig } from "next-intl/server";
import { getUserLocale } from "./locale";

export default getRequestConfig(async () => {
  const locale = await getUserLocale();


  const [mainMessages, authMessages, landingMessages] = await Promise.all([
    import(`../messages/${locale}.json`).then((m) => m.default),
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
      ...mainMessages,
      ...authMessages,
      LandingPage: landingMessages,
    },
    timeZone: "UTC",
  };
});
