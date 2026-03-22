export interface FaqItemConfig {
  answerCount: number;
  hasInstallButton?: boolean;
  emailAction?: 'requestFeature' | 'requestLanguage';
}

/** Must stay aligned with `messages/landing/*.json` → `LandingPage.faq.items` length and answer arrays. */
export const TATOEBA_FAQ_INDEX = 7;

export const landingFaqConfig: FaqItemConfig[] = [
  { answerCount: 2 },
  { answerCount: 5 },
  { answerCount: 2, emailAction: 'requestFeature' },
  { answerCount: 3 },
  { answerCount: 2, emailAction: 'requestLanguage' },
  { answerCount: 2 },
  { answerCount: 1 },
  { answerCount: 1 },
  { answerCount: 1, hasInstallButton: true },
];
