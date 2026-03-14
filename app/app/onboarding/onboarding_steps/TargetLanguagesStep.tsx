import { useTranslations } from 'next-intl';
import { LanguageSelector } from '@/components/course/LanguageSelector';

interface TargetLanguagesStepProps {
  selectedLanguages: string[];
  excludeLanguages?: string[];
  onToggleLanguage: (languageCode: string) => void;
}

export function TargetLanguagesStep({
  selectedLanguages,
  excludeLanguages,
  onToggleLanguage,
}: TargetLanguagesStepProps) {
  const t = useTranslations('Onboarding.targetLanguage');

  return (
    <LanguageSelector
      title={t('title')}
      subtitle={t('subtitle')}
      selectedLanguages={selectedLanguages}
      excludeLanguages={excludeLanguages}
      onToggleLanguage={onToggleLanguage}
      multiSelect={false}
    />
  );
}
