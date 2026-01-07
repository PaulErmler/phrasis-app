import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/components/course/LanguageSelector";

interface BaseLanguagesStepProps {
  selectedLanguages: string[];
  excludeLanguages: string[];
  onToggleLanguage: (languageCode: string) => void;
}

export function BaseLanguagesStep({
  selectedLanguages,
  excludeLanguages,
  onToggleLanguage,
}: BaseLanguagesStepProps) {
  const t = useTranslations("Onboarding.step3");

  return (
    <LanguageSelector
      title={t("title")}
      subtitle={t("subtitle")}
      selectedLanguages={selectedLanguages}
      excludeLanguages={excludeLanguages}
      onToggleLanguage={onToggleLanguage}
      multiSelect={false}
    />
  );
}
