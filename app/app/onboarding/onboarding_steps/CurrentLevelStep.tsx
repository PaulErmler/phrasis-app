import { useTranslations } from "next-intl";
import { DifficultySelector, LEVEL_ICONS } from "@/components/course/DifficultySelector";
import { CurrentLevel } from "../types";

interface CurrentLevelStepProps {
  selectedLevel: CurrentLevel | null;
  onSelectLevel: (level: CurrentLevel) => void;
  targetLanguageName?: string;
}

export function CurrentLevelStep({ selectedLevel, onSelectLevel, targetLanguageName = "Spanish" }: CurrentLevelStepProps) {
  const t = useTranslations("Onboarding.step4");

  const levels = [
    {
      id: "beginner" as const,
      icon: LEVEL_ICONS.beginner,
      title: t("beginner.title"),
      description: t("beginner.description", { language: targetLanguageName }),
    },
    {
      id: "elementary" as const,
      icon: LEVEL_ICONS.elementary,
      title: t("elementary.title"),
      description: t("elementary.description"),
    },
    {
      id: "intermediate" as const,
      icon: LEVEL_ICONS.intermediate,
      title: t("intermediate.title"),
      description: t("intermediate.description"),
    },
    {
      id: "upper_intermediate" as const,
      icon: LEVEL_ICONS.upper_intermediate,
      title: t("upper_intermediate.title"),
      description: t("upper_intermediate.description"),
    },
    {
      id: "advanced" as const,
      icon: LEVEL_ICONS.advanced,
      title: t("advanced.title"),
      description: t("advanced.description"),
    },
  ];

  return (
    <DifficultySelector
      title={t("title")}
      selectedLevel={selectedLevel}
      onSelectLevel={onSelectLevel}
      levelOptions={levels}
    />
  );
}
