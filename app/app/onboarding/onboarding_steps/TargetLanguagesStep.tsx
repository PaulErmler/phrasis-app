import { useTranslations } from "next-intl";
import { LanguageSelector } from "@/components/course/LanguageSelector";

interface TargetLanguagesStepProps {
  selectedLanguages: string[];
  onToggleLanguage: (languageCode: string) => void;
}

export function TargetLanguagesStep({
  selectedLanguages,
  onToggleLanguage,
}: TargetLanguagesStepProps) {
  const t = useTranslations("Onboarding.step2");

  return (
    <LanguageSelector
      title={t("title")}
      subtitle={t("subtitle")}
      selectedLanguages={selectedLanguages}
      onToggleLanguage={onToggleLanguage}
      multiSelect={false}
    />
  );
}
