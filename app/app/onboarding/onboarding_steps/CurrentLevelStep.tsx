import { useTranslations } from "next-intl";
import { GraduationCap, BookOpen, MessageSquare, Globe, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CurrentLevel } from "../types";
import { cn } from "@/lib/utils";

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
      icon: GraduationCap,
      title: t("beginner.title"),
      description: t("beginner.description", { language: targetLanguageName }),
      color: "text-primary",
    },
    {
      id: "elementary" as const,
      icon: BookOpen,
      title: t("elementary.title"),
      description: t("elementary.description"),
      color: "text-primary",
    },
    {
      id: "intermediate" as const,
      icon: MessageSquare,
      title: t("intermediate.title"),
      description: t("intermediate.description"),
      color: "text-primary",
    },
    {
      id: "upper_intermediate" as const,
      icon: Globe,
      title: t("upper_intermediate.title"),
      description: t("upper_intermediate.description"),
      color: "text-primary",
    },
    {
      id: "advanced" as const,
      icon: Star,
      title: t("advanced.title"),
      description: t("advanced.description"),
      color: "text-primary",
    },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center space-y-2">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      </div>
      
      <div className="space-y-3 max-w-md mx-auto">
        {levels.map((level) => {
          const Icon = level.icon;
          const isSelected = selectedLevel === level.id;
          
          return (
            <Button
              key={level.id}
              variant="ghost"
              onClick={() => onSelectLevel(level.id)}
              className={cn(
                "w-full h-auto flex items-center justify-start gap-4 p-4 rounded-xl border-2 transition-all text-left whitespace-normal",
                isSelected
                  ? "border-primary bg-primary/5 shadow-sm hover:bg-primary/5"
                  : "border-muted hover:border-muted-foreground/30 hover:bg-muted/50"
              )}
            >
              <div className={cn("p-2.5 rounded-lg shrink-0", level.color)}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base leading-none mb-1">
                  {level.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {level.description}
                </p>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
