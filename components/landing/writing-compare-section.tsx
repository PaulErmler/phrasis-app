'use client';

import Image from 'next/image';
import { useLocale, useTranslations } from 'next-intl';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { DiffDisplay } from '@/components/app/learning/DiffDisplay';
import { AccuracyFooter } from '@/components/app/learning/CleanRevealedSentence';
import { WritingFeedbackCard } from '@/components/app/learning/WritingFeedbackCard';
import type { CardTranslation } from '@/components/app/learning/types';
import { LandingAudioButton } from '@/components/landing/LandingAudioButton';
import { LandingCardShell } from '@/components/landing/LandingCardShell';
import { Separator } from '@/components/ui/separator';
import { getLandingAudioUrl } from '@/lib/landing/audio';
import { getLanguageShortLabel } from '@/lib/languages';
import { computeAccuracy } from '@/lib/textCompare';
import { fadeInUp } from './animations';

function stripWord(token: string): string {
  return token.replace(/^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu, '').toLowerCase();
}

/**
 * String-match grader: credit a typed word only when it also appears in the
 * expected sentence. No corrections, no meaning.
 */
function OtherAppsWordMatch({
  typed,
  expected,
}: {
  typed: string;
  expected: string;
}) {
  const expectedBare = new Set(
    expected
      .split(/\s+/)
      .map(stripWord)
      .filter(Boolean),
  );
  const parts = typed.split(/(\s+)/);
  const accuracy = computeAccuracy(expected, typed, 'es');

  return (
    <div>
      <p
        lang="es"
        className="leading-relaxed flex flex-wrap items-baseline gap-x-1 gap-y-2 pt-1"
      >
        {parts.map((part, i) => {
          if (/^\s+$/.test(part) || part.length === 0) return null;
          const correct = expectedBare.has(stripWord(part));
          return (
            <span
              key={i}
              className={
                correct
                  ? 'rounded-sm bg-success/15 text-success px-1 py-0.5'
                  : 'rounded-sm bg-destructive/15 text-destructive line-through px-1 py-0.5'
              }
            >
              {part}
            </span>
          );
        })}
      </p>
      <AccuracyFooter accuracy={accuracy} />
    </div>
  );
}

/**
 * Same typed Spanish sentence, two graders. The learning card above is the
 * prompt; other apps credit matching words only; Flexling shows the real
 * writing diff (retargeted after Also correct) plus the tutor card.
 */
export function WritingCompareSection() {
  const t = useTranslations('LandingPage.writingCompare');
  const locale = useLocale();
  const primaryBaseLang = locale.startsWith('de') ? 'de' : 'en';
  // DO NOT TRANSLATE `typed` / `expected`: they are Spanish demo sentences
  // in every bundle (the learner writes Spanish whatever the page locale).
  // Localizing them would silently break the hardcoded lang="es" markup,
  // computeAccuracy(..., 'es'), and the audio-manifest lookup below.
  const typed = t('typed');
  const expected = t('expected');

  const translations: CardTranslation[] = [
    {
      language: primaryBaseLang,
      text: t('prompt'),
      isBaseLanguage: true,
      isTargetLanguage: false,
    },
  ];

  return (
    <section
      id="writing-feedback"
      className="relative py-20 md:py-32 px-4 sm:px-6 border-t border-border/40"
      data-testid="landing-writing-compare"
    >
      <div className="max-w-7xl mx-auto">
        <motion.div {...fadeInUp} className="space-y-5 max-w-3xl mb-10 md:mb-14">
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-semibold tracking-tight text-foreground">
            {t('title')}{' '}
            <span className="text-primary">{t('titleHighlight')}</span>
          </h2>
          <p className="text-base md:text-lg text-muted-foreground leading-relaxed">
            {t('subtitle')}
          </p>
        </motion.div>

        <motion.div
          {...fadeInUp}
          transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' as const }}
          className="min-w-0 max-w-4xl mx-auto"
        >
          <LandingCardShell
            bare
            reviewCount={2}
            sourceText=""
            translations={translations}
            audioRecordings={[]}
            isFavorite={false}
            isPendingMaster={false}
            isPendingHide={false}
            onMaster={() => {}}
            onHide={() => {}}
            onFavorite={() => {}}
            showRomanization={false}
          >
            {() => (
              <div className="space-y-4">
                <div className="flex items-start gap-2 border-l-2 border-border/40 pl-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-muted-foreground mb-1">
                      {t('expectedLabel')}
                    </p>
                    <p lang="es" className="body-large">
                      {expected}
                    </p>
                  </div>
                  <LandingAudioButton
                    url={getLandingAudioUrl(expected, 'es')}
                    language={getLanguageShortLabel('es')}
                  />
                </div>
                <Separator />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                  <div>
                    <div className="flex items-center gap-2.5 mb-3">
                      <X className="h-5 w-5 text-destructive shrink-0" />
                      <h3 className="text-base md:text-lg font-semibold">
                        {t('otherApps')}
                      </h3>
                    </div>
                    <OtherAppsWordMatch typed={typed} expected={expected} />
                  </div>
                  <div className="md:border-l md:border-border/40 md:pl-8">
                    <div className="flex items-center gap-2.5 mb-3">
                      <Image
                        src="/icons/icon.svg"
                        alt=""
                        width={20}
                        height={20}
                        className="h-5 w-5 shrink-0"
                      />
                      <h3 className="text-base md:text-lg font-semibold">
                        {t('flexling')}
                      </h3>
                    </div>
                    {/* Deliberate self-diff: the alsoCorrect verdict means
                        the diff targets the learner's own accepted wording,
                        so everything renders green — the real writing-mode
                        behavior, not a shortcut. */}
                    <DiffDisplay
                      expected={typed}
                      actual={typed}
                      language="es"
                    />
                    {/* Reuses the app's accepted-answers testid on purpose:
                        this block mirrors that exact UI, and the section
                        test asserts the same structure the app renders. */}
                    <div
                      className="flex flex-col gap-1.5 pt-1"
                      data-testid="writing-feedback-other-accepted"
                    >
                      <p lang="es" className="text-sm text-muted-foreground">
                        {expected}
                      </p>
                    </div>
                    <WritingFeedbackCard
                      feedback={{
                        status: 'done',
                        result: {
                          verdict: 'alsoCorrect',
                          corrected: typed,
                          notes: [
                            {
                              type: 'naturalness',
                              text: t('naturalnessNote'),
                            },
                          ],
                          savedAlternative: true,
                        },
                      }}
                    />
                  </div>
                </div>
              </div>
            )}
          </LandingCardShell>
        </motion.div>
      </div>
    </section>
  );
}
