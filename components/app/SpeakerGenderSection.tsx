'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { cn } from '@/lib/utils';
import { useAppData } from '@/components/app/AppDataProvider';
import {
  resolveSpeakerGenderPreference,
  type SpeakerGenderPreference,
} from '@/lib/speakerGender';
import {
  getLocalizedLanguageNameByCode,
  languageMarksSpeakerGender,
} from '@/lib/languages';

/** Display order: the default first. */
const OPTIONS: SpeakerGenderPreference[] = ['mixed', 'female', 'male'];

/**
 * Account-level speaker-gender preference (lib/speakerGender.ts): which
 * gender sentences are voiced in everywhere, and — in languages whose
 * grammar or word choice marks the speaker — additionally phrased for.
 * The note under the control names the active course's languages where the
 * phrasing effect applies, so the setting is honest about what it does for
 * the user's specific language pair.
 */
export function SpeakerGenderSection() {
  const t = useTranslations('AppPage.settings.speakerGender');
  const locale = useLocale();
  const { activeCourse } = useAppData();
  const settings = useQuery(api.features.courses.getUserSettings);
  const setPreference = useMutation(
    api.features.courses.setSpeakerGenderPreference,
  ).withOptimisticUpdate((localStore, args) => {
    const current = localStore.getQuery(api.features.courses.getUserSettings, {});
    if (current) {
      localStore.setQuery(
        api.features.courses.getUserSettings,
        {},
        { ...current, speakerGenderPreference: args.preference },
      );
    }
  });

  const current = resolveSpeakerGenderPreference(
    settings?.speakerGenderPreference,
  );

  // Languages of the active course (both sides — the one being learned and
  // the one the user comes from) where the preference also changes phrasing.
  const markingLanguages = [
    ...new Set([
      ...(activeCourse?.baseLanguages ?? []),
      ...(activeCourse?.targetLanguages ?? []),
    ]),
  ].filter(languageMarksSpeakerGender);
  const markingLanguageNames = markingLanguages
    .map((code) => getLocalizedLanguageNameByCode(code, locale))
    .join(', ');

  return (
    <div className="space-y-2">
      <label className="label-form">{t('label')}</label>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
      <div className="flex w-full rounded-lg border bg-muted/50 p-1">
        {OPTIONS.map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => void setPreference({ preference: option })}
            data-testid={`settings-speaker-gender-${option}`}
            aria-pressed={current === option}
            className={cn(
              'flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-all whitespace-nowrap',
              current === option
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t(`options.${option}`)}
          </button>
        ))}
      </div>
      {markingLanguages.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('affectsPhrasing', { languages: markingLanguageNames })}
        </p>
      )}
    </div>
  );
}
