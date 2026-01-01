import { useTranslations } from "next-intl";
import { Coffee, Target, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LearningStyle } from "../types";
import { cn } from "@/lib/utils";

interface LearningStyleStepProps {
  selectedStyle: LearningStyle | null;
  onSelectStyle: (style: LearningStyle) => void;
}

export function LearningStyleStep({ selectedStyle, onSelectStyle }: LearningStyleStepProps) {
  const t = useTranslations("Onboarding.step1");

  const styles = [
    {
      id: "casual" as const,
      icon: Coffee,
      title: t("casual.title"),
      description: t("casual.description"),
      color: "text-primary",
    },
    {
      id: "focused" as const,
      icon: Target,
      title: t("focused.title"),
      description: t("focused.description"),
      color: "text-primary",
    },
    {
      id: "advanced" as const,
      icon: Zap,
      title: t("advanced.title"),
      description: t("advanced.description"),
      color: "text-primary",
    },
  ];

  return (
    <div className="flex flex-col h-full animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center space-y-2 mb-6 py-3">
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
      </div>
      
      <div className="flex-1 flex flex-col gap-3 overflow-y-auto py-3 pr-3">
        {styles.map((style) => {
          const Icon = style.icon;
          const isSelected = selectedStyle === style.id;
          
          return (
            <Button
              key={style.id}
              variant="ghost"
              onClick={() => onSelectStyle(style.id)}
              className={cn(
                "w-full h-auto flex items-center justify-start gap-4 p-4 rounded-xl border-2 transition-all text-left whitespace-normal",
                isSelected
                  ? "border-primary bg-primary/5 shadow-sm hover:bg-primary/5"
                  : "border-muted hover:border-muted-foreground/30 hover:bg-muted/50"
              )}
            >
              <div className={cn("p-2.5 rounded-lg shrink-0", style.color)}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base leading-none mb-1">
                  {style.title}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {style.description}
                </p>
              </div>
            </Button>
          );
        })}
      </div>
    </div>
  );
}
